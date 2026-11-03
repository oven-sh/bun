#![warn(unused_must_use)]

use core::ffi::c_void;
use core::hash::{BuildHasherDefault, Hasher};
use std::sync::Arc;

use bun_core::Ordinal;
use bun_sourcemap::parsed_source_map::AnySourceProvider;
use bun_sourcemap::{self as SourceMap, ParsedSourceMap};
use bun_threading::guarded::GuardedLock;
use bun_threading::{Guarded, Mutex};

use crate::resolved_source::SourceMapBlob;

/// A `JSC::SourceProvider`, which holds one text that JavaScriptCore runs: the key of the source map of that text.
pub type Provider = *const c_void;

/// The source maps of one VM, by provider. Providers with equal URL and text share the newest map (#47842).
#[derive(Default)]
pub struct SavedSourceMap {
    inner: Guarded<Inner>,
}

#[derive(Default)]
struct Inner {
    /// By address, of live providers only: `Bun::SourceMapRegistration` takes a provider out before it is destroyed.
    providers: Table<Entry>,
    /// By `Entry::text`.
    texts: Table<Text>,
    /// By the hash of a source URL: the first of the list of its texts (`Text::older`).
    urls: Table<u64>,
    /// How many texts there were. A text has the number it was counted with, and none has 0.
    texts_made: u64,
}

struct Entry {
    /// The number of the text in `Inner::texts`.
    text: u64,
    /// The providers of a text are a ring. `older` registered before this one. Aliases of the map come last.
    older: usize,
    newer: usize,
    /// Reads the map of the text through this provider, if it registered as one that does.
    loader: Option<AnySourceProvider>,
}

struct Text {
    map: Map,
    /// The provider that registered last. One that only shares the map when no other is left.
    head: usize,
    /// `Bun__SourceProvider__hash`: two texts with different ones are different.
    hash: u32,
    /// Another text registered under the URL after this one did. The file under the URL is that text now.
    superseded: bool,
    /// The hash of the source URL.
    url: u64,
    /// The texts of a URL are a list. The one that registered last is the first, and 0 ends the list.
    older: u64,
    newer: u64,
}

enum Map {
    /// What the printer made with the text.
    Printed(SourceMapBlob),
    /// `Printed`, in the refcounted shell that readers hold.
    Parsed(Arc<ParsedSourceMap>),
    /// `Entry::loader` of the head reads it when a position is first asked for.
    NotRead,
    /// What the head read. It goes back to `NotRead` when another text registers under the URL next.
    Read(Arc<ParsedSourceMap>),
    /// There is none: do not look again.
    Missing,
}

impl Map {
    /// `Printed` becomes `Parsed`: the blob moves into a refcounted shell that callers can hold, with no VLQ decode.
    fn parse_printed(&mut self) -> Option<Arc<ParsedSourceMap>> {
        let Map::Printed(blob) = core::mem::replace(self, Map::Missing) else {
            unreachable!()
        };
        let map = blob.into_parsed()?;
        *self = Map::Parsed(Arc::clone(&map));
        Some(map)
    }
}

/// `SavedSourceMap::peek`.
pub enum Saved {
    Map(Arc<ParsedSourceMap>),
    /// A provider reads it when `SavedSourceMap::read` asks.
    NotRead(SavedText),
    None,
}

/// A text that has a map, for `SavedSourceMap::read`: the text can be gone by then.
#[derive(Clone, Copy)]
pub struct SavedText(u64);

unsafe extern "C" {
    /// `provider->sourceURL() == url`.
    fn Bun__SourceProvider__hasSourceURL(provider: Provider, url: &bun_core::String) -> bool;
    /// The source URL and the text of both are the same.
    fn Bun__SourceProvider__hasSameSource(a: Provider, b: Provider) -> bool;
    /// `provider->hash()`, of the text. JavaScriptCore asks for the same when it compiles the text.
    fn Bun__SourceProvider__hash(provider: Provider) -> u32;
    /// `provider->sourceURL()`.
    fn Bun__SourceProvider__sourceURL(provider: Provider) -> bun_core::String;
}

/// The keys are addresses, hashes and counts: hashbrown takes the bucket from the low bits, the tag from the high ones.
#[derive(Default)]
struct KeyHasher(u64);

impl Hasher for KeyHasher {
    #[inline]
    fn write(&mut self, _: &[u8]) {
        unreachable!()
    }
    #[inline]
    fn write_u64(&mut self, key: u64) {
        let hash = key.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        self.0 = hash ^ (hash >> 32);
    }
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}

/// hashbrown reclaims the slots of removed entries, which `bun_collections::HashMap` only does when it grows.
type Table<V> = bun_collections::hashbrown::HashMap<u64, V, BuildHasherDefault<KeyHasher>>;

/// Thin forwarder to the leaf-crate state in
/// `bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo` so the path
/// recorded here is the same one `run_command` prints.
pub(crate) mod missing_source_map_note_info {
    #[inline]
    pub(super) fn record(path: &[u8]) {
        bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo::set_path(path);
    }
}

/// Of the characters of the URL, as UTF-8: one URL is an 8-bit string in one place and a 16-bit one in another.
fn url_key(url: &bun_core::String) -> u64 {
    if url.is_8bit() {
        let latin1 = url.latin1();
        if bun_core::strings::first_non_ascii(latin1).is_none() {
            return bun_wyhash::hash(latin1);
        }
    }
    bun_wyhash::hash(&url.to_utf8())
}

/// What `Inner::register` finds the text of `provider` by. `url` is its source URL.
fn text_key(provider: Provider, url: &bun_core::String) -> (u64, u32) {
    // SAFETY: `provider` registers, so it is live.
    (url_key(url), unsafe { Bun__SourceProvider__hash(provider) })
}

fn member(providers: &mut Table<Entry>, provider: usize) -> &mut Entry {
    providers
        .get_mut(&(provider as u64))
        .expect("every provider of a ring is in the table")
}

/// Makes room for `provider` in the ring between `head` and the provider before it, which is returned.
fn link(providers: &mut Table<Entry>, head: usize, provider: usize) -> usize {
    let last = core::mem::replace(&mut member(providers, head).newer, provider);
    member(providers, last).older = provider;
    last
}

/// What a registration took out of the table, to be dropped when the lock is released.
#[derive(Default)]
struct Replaced(Option<Map>, Option<Map>);

impl Inner {
    /// `provider` holds a text with that URL hash and text hash. `loader` reads `map` if it is `Map::NotRead`.
    fn register(
        &mut self,
        provider: Provider,
        (url, hash): (u64, u32),
        map: Map,
        loader: Option<AnySourceProvider>,
    ) -> Replaced {
        use bun_collections::hashbrown::hash_map::Entry as Slot;
        const LISTED: &str = "every text of a list is in the table";

        let address = provider as usize;
        debug_assert!(address != 0);
        debug_assert!(!self.providers.contains_key(&(address as u64)));

        let first = self.urls.entry(url);
        let newest = match &first {
            Slot::Occupied(slot) => *slot.get(),
            Slot::Vacant(_) => 0,
        };
        // The text of `provider`, if a provider of it is here.
        let mut number = newest;
        while number != 0 {
            let text = self.texts.get(&number).expect(LISTED);
            let head = text.head as Provider;
            // SAFETY: both are live: `head` is in the table, and `provider` registers.
            let same =
                text.hash == hash && unsafe { Bun__SourceProvider__hasSameSource(head, provider) };
            if same {
                break;
            }
            // A hash that is not a hash of the text keeps the providers of one text apart.
            // SAFETY: as above.
            debug_assert!(!unsafe { Bun__SourceProvider__hasSameSource(head, provider) });
            number = text.older;
        }

        let mut replaced = Replaced::default();
        let mut ring = (address, address);
        if number == 0 {
            self.texts_made += 1;
            number = self.texts_made;
            self.texts.insert(
                number,
                Text {
                    map,
                    head: address,
                    hash,
                    superseded: false,
                    url,
                    older: newest,
                    newer: 0,
                },
            );
        } else {
            let text = self.texts.get_mut(&number).expect(LISTED);
            text.superseded = false;
            let head = core::mem::replace(&mut text.head, address);
            replaced.0 = Some(core::mem::replace(&mut text.map, map));
            ring = (head, link(&mut self.providers, head, address));
            if number != newest {
                // Out of its place in the list: it goes to the front.
                let (older, newer) = (text.older, text.newer);
                (text.older, text.newer) = (newest, 0);
                self.texts.get_mut(&newer).expect(LISTED).older = older;
                if older != 0 {
                    self.texts.get_mut(&older).expect(LISTED).newer = newer;
                }
            }
        }
        self.providers.insert(
            address as u64,
            Entry {
                text: number,
                older: ring.0,
                newer: ring.1,
                loader,
            },
        );

        // It is the text that registered last under the URL now.
        if number != newest {
            if newest != 0 {
                let previous = self.texts.get_mut(&newest).expect(LISTED);
                previous.newer = number;
                previous.superseded = true;
                if matches!(previous.map, Map::Read(_)) {
                    replaced.1 = Some(core::mem::replace(&mut previous.map, Map::NotRead));
                }
            }
            match first {
                Slot::Occupied(mut slot) => {
                    slot.insert(number);
                }
                Slot::Vacant(slot) => {
                    slot.insert(number);
                }
            }
        }
        replaced
    }

    fn text(&mut self, number: u64) -> &mut Text {
        self.texts
            .get_mut(&number)
            .expect("the text of a provider is in the table")
    }

    /// Takes a text out of the list of its URL.
    fn unlist(&mut self, number: u64) {
        let text = self.text(number);
        let (url, older, newer) = (text.url, text.older, text.newer);
        (text.older, text.newer) = (0, 0);
        if older != 0 {
            self.text(older).newer = newer;
        }
        if newer != 0 {
            self.text(newer).older = older;
        } else if self.urls.get(&url) == Some(&number) {
            if older != 0 {
                self.urls.insert(url, older);
            } else {
                self.urls.remove(&url);
            }
        }
    }

    fn alias(&mut self, provider: Provider, existing: Provider) -> bool {
        let address = provider as usize;
        debug_assert!(address != 0 && provider != existing);
        debug_assert!(!self.providers.contains_key(&(address as u64)));
        let Some(text) = self.providers.get(&(existing as u64)).map(|e| e.text) else {
            return false;
        };
        let head = self.text(text).head;
        // Before `head` in the ring is after every other one.
        let last = link(&mut self.providers, head, address);
        self.providers.insert(
            address as u64,
            Entry {
                text,
                older: head,
                newer: last,
                loader: None,
            },
        );
        true
    }

    /// Returns the map that nothing refers to any more.
    fn remove(&mut self, provider: Provider) -> Option<Map> {
        let address = provider as usize;
        let entry = self.providers.remove(&(address as u64))?;
        if entry.older == address {
            self.unlist(entry.text);
            return self.texts.remove(&entry.text).map(|text| text.map);
        }
        member(&mut self.providers, entry.newer).older = entry.older;
        let next = member(&mut self.providers, entry.older);
        next.newer = entry.newer;
        let next_reads = next.loader.is_some();
        let text = self.text(entry.text);
        if text.head != address {
            return None;
        }
        text.head = entry.older;
        // What the provider that is gone read, or was to read, is for the next one to read.
        if matches!(text.map, Map::Printed(_) | Map::Parsed(_)) {
            return None;
        }
        Some(core::mem::replace(
            &mut text.map,
            if next_reads {
                Map::NotRead
            } else {
                Map::Missing
            },
        ))
    }
}

impl SavedSourceMap {
    /// `provider` holds the text that the printer made `blob` with, and `url` is its source URL.
    pub fn register_mappings(
        &self,
        provider: Provider,
        url: &bun_core::String,
        blob: SourceMapBlob,
    ) {
        let key = text_key(provider, url);
        let replaced = (self.inner.lock()).register(provider, key, Map::Printed(blob), None);
        drop(replaced);
    }

    /// `provider` reads the map of its text when a position in it is first asked for. `url` is its source URL.
    pub fn register_source_provider(&self, provider: AnySourceProvider, url: &bun_core::String) {
        let key = text_key(provider.ptr(), url);
        let replaced =
            (self.inner.lock()).register(provider.ptr(), key, Map::NotRead, Some(provider));
        drop(replaced);
    }

    /// `provider` wraps the text of `existing` and shares its map. False when `existing` has no map.
    pub fn alias(&self, provider: Provider, existing: Provider) -> bool {
        self.inner.lock().alias(provider, existing)
    }

    /// `provider` holds another text that `existing`'s printed map maps too (a compile hook's retry). False: no map.
    pub fn share(&self, provider: Provider, url: &bun_core::String, existing: Provider) -> bool {
        let key = text_key(provider, url);
        let mut inner = self.inner.lock();
        let Some(number) = inner.providers.get(&(existing as u64)).map(|e| e.text) else {
            return false;
        };
        let text = inner.text(number);
        let map = match &text.map {
            Map::Parsed(map) => Some(Arc::clone(map)),
            Map::Printed(_) => text.map.parse_printed(),
            Map::NotRead | Map::Read(_) | Map::Missing => None,
        };
        let Some(map) = map else {
            return false;
        };
        let replaced = inner.register(provider, key, Map::Parsed(map), None);
        drop(inner);
        drop(replaced);
        true
    }

    /// `provider` is being destroyed.
    pub fn remove(&self, provider: Provider) {
        let unused = self.inner.lock().remove(provider);
        drop(unused);
    }

    /// The provider that registered last under `url`: for a parser's SyntaxError, which has a URL and no provider.
    pub fn newest_for_url(&self, url: &bun_core::String) -> Option<Provider> {
        let inner = self.inner.lock();
        let text = inner.texts.get(inner.urls.get(&url_key(url))?)?;
        let head = text.head as Provider;
        // SAFETY: `head` is in the table, so it is live.
        (!text.superseded && unsafe { Bun__SourceProvider__hasSourceURL(head, url) })
            .then_some(head)
    }

    /// Whether the file that a frame names can hold its text: no other text registered under the URL after that one.
    pub(crate) fn names_file_text(&self, provider: Provider, url: &bun_core::String) -> bool {
        if provider.is_null() {
            return self.newest_for_url(url).is_some();
        }
        let inner = self.inner.lock();
        inner
            .providers
            .get(&(provider as u64))
            .and_then(|entry| inner.texts.get(&entry.text))
            .is_some_and(|text| !text.superseded)
    }

    /// How many providers have a map.
    pub fn len(&self) -> usize {
        self.inner.lock().providers.len()
    }

    fn get_with_content(
        &self,
        provider: Provider,
        hint: SourceMap::ParseUrlResultHint,
    ) -> SourceMap::ParseUrl {
        // Code without a provider: a position parsed back out of a stack string.
        if provider.is_null() {
            return SourceMap::ParseUrl::default();
        }
        let guard = self.inner.lock();
        match guard.providers.get(&(provider as u64)).map(|e| e.text) {
            Some(text) => self.text_with_content(guard, text, hint),
            None => SourceMap::ParseUrl::default(),
        }
    }

    /// The map of the text with that number, which the head of the text reads if nothing did.
    fn text_with_content(
        &self,
        mut guard: GuardedLock<'_, Inner, Mutex>,
        number: u64,
        hint: SourceMap::ParseUrlResultHint,
    ) -> SourceMap::ParseUrl {
        let found = |map: &Arc<ParsedSourceMap>| SourceMap::ParseUrl {
            map: Some(Arc::clone(map)),
            ..Default::default()
        };
        let inner = &mut *guard;
        // A text that `SavedSourceMap::read` asks for can be gone.
        let Some(text) = inner.texts.get_mut(&number) else {
            return SourceMap::ParseUrl::default();
        };
        let head = text.head;
        let loader = match &text.map {
            Map::Parsed(map) | Map::Read(map) => return found(map),
            Map::Missing => return SourceMap::ParseUrl::default(),
            Map::Printed(_) => {
                return match text.map.parse_printed() {
                    Some(map) => found(&map),
                    None => SourceMap::ParseUrl::default(),
                };
            }
            Map::NotRead => match member(&mut inner.providers, head).loader {
                Some(loader) => loader,
                None => return SourceMap::ParseUrl::default(),
            },
        };
        // Not the URL of the frame: a `//# sourceURL` in the text changes that one, and the map is beside the file.
        // SAFETY: `head` is in the table, so it is live.
        let url = unsafe { Bun__SourceProvider__sourceURL(head as Provider) };
        // Not with the lock held: this reads a file and parses JSON. `head` stays live (see `Inner::providers`).
        drop(guard);
        let url = url.to_utf8();
        let parse = loader.get_source_map(&url, Default::default(), hint);
        let map = parse.as_ref().and_then(|parse| parse.map.as_ref());

        let mut guard = self.inner.lock();
        if let Some(text) = guard.texts.get_mut(&number)
            && text.head == head
            && matches!(text.map, Map::NotRead)
        {
            text.map = match map {
                Some(map) => Map::Read(Arc::clone(map)),
                None => Map::Missing,
            };
        }
        drop(guard);
        if map.is_none() {
            // Store path for a user note.
            missing_source_map_note_info::record(&url);
        }

        match parse {
            Some(parse) if parse.map.is_some() => parse,
            _ => SourceMap::ParseUrl::default(),
        }
    }

    /// The map of the text that `provider` holds.
    pub fn get(&self, provider: Provider) -> Option<Arc<ParsedSourceMap>> {
        self.get_with_content(provider, SourceMap::ParseUrlResultHint::MappingsOnly)
            .map
    }

    /// `get` for a reader that can wait: nothing is read here.
    pub fn peek(&self, provider: Provider) -> Saved {
        let mut inner = self.inner.lock();
        let Some(number) = inner.providers.get(&(provider as u64)).map(|e| e.text) else {
            return Saved::None;
        };
        let text = inner.text(number);
        match &text.map {
            Map::Parsed(map) | Map::Read(map) => Saved::Map(Arc::clone(map)),
            Map::NotRead => Saved::NotRead(SavedText(number)),
            Map::Missing => Saved::None,
            Map::Printed(_) => match text.map.parse_printed() {
                Some(map) => Saved::Map(map),
                None => Saved::None,
            },
        }
    }

    /// The map of `text`, if a provider of it is still there.
    pub fn read(&self, text: SavedText) -> Option<Arc<ParsedSourceMap>> {
        let guard = self.inner.lock();
        self.text_with_content(guard, text.0, SourceMap::ParseUrlResultHint::MappingsOnly)
            .map
    }

    /// `line` and `column` are a position in the text that `provider` holds.
    pub(crate) fn resolve_mapping(
        &self,
        provider: Provider,
        line: Ordinal,
        column: Ordinal,
        source_handling: SourceMap::SourceContentHandling,
    ) -> Option<SourceMap::mapping::Lookup> {
        let parse = self.get_with_content(
            provider,
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

        // The names of a map in the executable are not paths from the text.
        let generated_url = if map.is_external() && !map.is_standalone_module_graph {
            // SAFETY: the frame that names `provider` holds a ref on it, or the table just gave it out.
            unsafe { Bun__SourceProvider__sourceURL(provider) }.into_utf8()
        } else {
            bun_core::Utf8Bytes::EMPTY
        };
        Some(SourceMap::mapping::Lookup {
            mapping,
            source_map: Some(map),
            prefetched_source_code: parse.source_contents,
            generated_url,
        })
    }
}
