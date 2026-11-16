#![warn(unused_must_use)]

use core::ffi::c_void;
use std::sync::Arc;

use bun_collections::{HashMap, IdentityContext};
use bun_core::MutableString;
use bun_core::Ordinal;
use bun_sourcemap::parsed_source_map::AnySourceProvider;
use bun_sourcemap::{self as SourceMap, InternalSourceMap, ParsedSourceMap};
use bun_threading::Guarded;
use bun_wyhash::hash;

#[derive(Default)]
pub struct SavedSourceMap {
    map: Guarded<HashTable>,
}

enum Value {
    /// The `InternalSourceMap` blob of a module that the runtime transpiled.
    Internal(Box<[u8]>),
    /// A lazy external source provider. The FFI handle in it is borrowed.
    Provider(AnySourceProvider),
    Parsed(Arc<ParsedSourceMap>),
}

/// Thin forwarder to the leaf-crate state in
/// `bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo` so the path
/// recorded here is the same one `run_command` prints.
pub(crate) mod missing_source_map_note_info {
    #[inline]
    pub(super) fn record(path: &[u8]) {
        bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo::set_path(path);
    }
}

impl SavedSourceMap {
    /// Registers a lazy external source provider for `path`, replacing any
    /// existing entry. The provider FFI handle is borrowed — its owner
    /// unregisters it via [`Self::remove_source_provider`] before freeing it.
    pub fn put_source_provider(&self, provider: AnySourceProvider, path: &[u8]) {
        self.put_value(path, Value::Provider(provider));
    }

    pub(crate) fn put_parsed(&self, path: &[u8], map: Arc<ParsedSourceMap>) {
        self.put_value(path, Value::Parsed(map));
    }

    /// Drops the entry for `path` if it still refers to
    /// `opaque_source_provider` — either as a registered provider entry, or
    /// as a `ParsedSourceMap` materialized from that provider.
    pub fn remove_source_provider(&self, opaque_source_provider: *mut c_void, path: &[u8]) {
        let mut map = self.map.lock();
        // `get`+`remove(&key)`: the std
        // backing has no key-slot pointer to hand out, and the key is a u64 hash
        // we already have in hand.
        let key = hash(path);
        let provider = match map.get(&key) {
            Some(Value::Provider(provider)) => Some(*provider),
            Some(Value::Parsed(parsed)) => parsed.underlying_provider.provider(),
            Some(Value::Internal(_)) | None => None,
        };
        if provider.is_some_and(|provider| provider.ptr() == opaque_source_provider) {
            map.remove(&key);
        }
    }
}

// Keys are
// already wyhash u64s, so use the passthrough hasher; `bun_collections`'
// zig_hash_map uses an 80% max load factor.
type HashTable = HashMap<u64, Value, IdentityContext<u64>>;

impl bun_js_printer::OnSourceMapChunk for SavedSourceMap {
    fn on_source_map_chunk(
        &self,
        chunk: SourceMap::Chunk,
        source: &bun_ast::Source,
    ) -> bun_js_printer::Result<()> {
        self.put_mappings(source, chunk.buffer)
    }
}

impl SavedSourceMap {
    pub fn put_mappings(
        &self,
        source: &bun_ast::Source,
        mappings: MutableString,
    ) -> bun_js_printer::Result<()> {
        let Some(incoming) = InternalSourceMap::new(&mappings.list) else {
            return Ok(());
        };

        // --hot can re-read a file mid-rewrite (truncate + write) and transpile
        // a comment-only prefix into a 0-mapping map. Overwriting a real map
        // with that would make any still-unreported error from the previous
        // transpile remap against nothing and leak transpiled coords. A map
        // with no mappings can never answer a lookup, so dropping it is never
        // worse than installing it.
        if incoming.mapping_count() == 0 && self.map.lock().contains_key(&hash(source.path.text)) {
            return Ok(());
        }

        let blob = mappings.list.into_boxed_slice();
        self.put_value(source.path.text, Value::Internal(blob));
        Ok(())
    }

    fn put_value(&self, path: &[u8], value: Value) {
        self.map.lock().insert(hash(path), value);
    }

    fn get_with_content(
        &self,
        path: &[u8],
        hint: SourceMap::ParseUrlResultHint,
    ) -> SourceMap::ParseUrl {
        let h = hash(path);

        let mut map = self.map.lock();
        let Some(mapping) = map.get_mut(&h) else {
            return SourceMap::ParseUrl::default();
        };

        let provider = match mapping {
            Value::Internal(blob) => {
                // Wraps the blob: no VLQ decode, no `Mapping.List`.
                let blob = core::mem::take(blob).into_vec();
                let result = Arc::new(ParsedSourceMap::from_internal(blob.into()));
                *mapping = Value::Parsed(Arc::clone(&result));
                return SourceMap::ParseUrl {
                    map: Some(result),
                    ..Default::default()
                };
            }
            Value::Parsed(parsed) => {
                return SourceMap::ParseUrl {
                    map: Some(Arc::clone(parsed)),
                    ..Default::default()
                };
            }
            Value::Provider(provider) => *provider,
        };
        drop(map);

        // Not under the lock: this parses JSON. The handle's owner unregisters it before freeing it.
        if let Some(parse) = provider.get_source_map(path, Default::default(), hint) {
            if let Some(ref parsed_map) = parse.map {
                self.put_parsed(path, Arc::clone(parsed_map));

                return parse;
            }
        }

        let mut map = self.map.lock();
        // does not have a valid source map. let's not try again
        map.remove(&h);

        // Store path for a user note.
        missing_source_map_note_info::record(path);
        SourceMap::ParseUrl::default()
    }

    pub fn get(&self, path: &[u8]) -> Option<std::sync::Arc<ParsedSourceMap>> {
        self.get_with_content(path, SourceMap::ParseUrlResultHint::MappingsOnly)
            .map
    }

    pub(crate) fn resolve_mapping(
        &self,
        path: &[u8],
        line: Ordinal,
        column: Ordinal,
        source_handling: SourceMap::SourceContentHandling,
    ) -> Option<SourceMap::mapping::Lookup> {
        let parse = self.get_with_content(
            path,
            match source_handling {
                SourceMap::SourceContentHandling::NoSourceContents => {
                    SourceMap::ParseUrlResultHint::MappingsOnly
                }
                SourceMap::SourceContentHandling::SourceContents => {
                    SourceMap::ParseUrlResultHint::All {
                        line: line.zero_based().max(0),
                        column: column.zero_based().max(0),
                        include_names: false,
                    }
                }
            },
        );
        let map = parse.map?;

        let mapping = match parse.mapping {
            Some(m) => m,
            // Pass `line`/`column` straight
            // through. `SourceMap::Ordinal` is a re-export of `bun_core::Ordinal`;
            // round-tripping via `from_zero_based(x.zero_based())` debug-asserts
            // on the legitimate INVALID (-1) sentinel.
            None => map.find_mapping(line, column)?,
        };

        Some(SourceMap::mapping::Lookup {
            mapping,
            source_map: Some(map),
            prefetched_source_code: parse.source_contents,
        })
    }
}
