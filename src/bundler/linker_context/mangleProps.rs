//! `--mangle-props`: one short name for every mangled property name across
//! the bundle.
//!
//! Each file's parser made one `Kind::MangledProp` symbol per distinct
//! property name it mangled. Here the symbols of the same name are merged
//! across files, ordered by use count and given the shortest names that
//! collide with nothing that keeps its original spelling: JS keywords, every
//! property name some file left as written, the `reserved` names and the
//! cache's keys and targets. The printers read the result through
//! `Options::mangled_props`, following each ref to its merged root first.

use crate::mal_prelude::*;

use bun_alloc::AllocError;
use bun_ast::Ref;
use bun_collections::StringHashMap;
use bun_options_types::MangleCacheEntry;
use bun_options_types::mangle_props::is_permanently_reserved_prop;

use crate::LinkerContext;
use crate::bundled_ast::Flags as AstFlags;

impl LinkerContext<'_> {
    pub(crate) fn mangle_props(&mut self) -> Result<(), AllocError> {
        let Some(options) = self.options.mangle_props.as_deref() else {
            return Ok(());
        };
        let _trace = bun_core::perf::trace("Bundler.mangleProps");

        let mangled_props_col = self.graph.ast.items_mangled_props();
        let reserved_props_col = self.graph.ast.items_reserved_props();
        let css_col = self.graph.ast.items_css();
        let flags_col = self.graph.ast.items_flags();
        let char_freq_col = self.graph.ast.items_char_freq();

        let mut reserved: StringHashMap<()> = StringHashMap::new();
        for keyword in bun_ast::lexer_tables::KEYWORDS.keys() {
            reserved.put(keyword, ())?;
        }
        for name in options.reserved.keys() {
            reserved.put(name, ())?;
        }
        for (original, mangled) in options.cache.iter() {
            reserved.put(original, ())?;
            if let Some(target) = mangled {
                reserved.put(target, ())?;
            }
        }

        // The symbol of the first reachable file that has a name becomes the
        // root every later file's symbol of that name links to.
        let mut freq = bun_ast::CharFreq::default();
        let mut merged: StringHashMap<Ref> = StringHashMap::new();
        let mut roots: Vec<Ref> = Vec::new();
        for &source_index in self.graph.reachable_files.iter() {
            let id = source_index.get() as usize;
            if source_index.is_runtime() || id >= mangled_props_col.len() || css_col[id].is_some() {
                continue;
            }
            for name in reserved_props_col[id].keys() {
                reserved.put(name, ())?;
            }
            for (name, &ref_) in mangled_props_col[id].iter() {
                let name: &[u8] = name;
                match merged.get(name) {
                    Some(&existing) => {
                        self.graph.symbols.merge(ref_, existing);
                    }
                    None => {
                        merged.put(name, ref_)?;
                        roots.push(ref_);
                    }
                }
            }
            if flags_col[id].contains(AstFlags::HAS_CHAR_FREQ) {
                freq.include(&char_freq_col[id]);
            }
        }

        // Most used first; ties in stable source order, then by symbol. The
        // roots are distinct symbols, so this order is total.
        let symbols = &self.graph.symbols;
        let stable_source_indices = self.graph.stable_source_indices.as_slice();
        let mut sorted: Vec<(u32, u32, Ref)> = roots
            .iter()
            .map(|&ref_| {
                let count = symbols.get_const(ref_).unwrap().use_count_estimate;
                (
                    count,
                    stable_source_indices[ref_.source_index() as usize],
                    ref_,
                )
            })
            .collect();
        sorted.sort_unstable_by(|a, b| {
            b.0.cmp(&a.0)
                .then(a.1.cmp(&b.1))
                .then(a.2.inner_index().cmp(&b.2.inner_index()))
        });

        let minifier = freq.compile();
        let mut name: Vec<u8> = Vec::with_capacity(16);
        let mut next: isize = 0;
        let mut generated: Vec<MangleCacheEntry> = Vec::new();
        self.mangled_props.reserve(sorted.len());
        for &(_, _, ref_) in &sorted {
            let original: &[u8] = symbols.get_const(ref_).unwrap().original_name.slice();
            if let Some(cached) = options.cache.get(original) {
                // `None` keeps the name as written; the parser never mangles
                // such a name, so only a pinned target reaches the map.
                if let Some(target) = cached {
                    self.mangled_props.put(ref_, target.clone())?;
                }
                continue;
            }
            loop {
                minifier.number_to_minified_name(&mut name, next)?;
                next += 1;
                if reserved.contains_key(name.as_slice()) || is_permanently_reserved_prop(&name) {
                    continue;
                }
                break;
            }
            reserved.put(&name, ())?;
            let mangled: Box<[u8]> = name.as_slice().into();
            generated.push(MangleCacheEntry {
                original: original.into(),
                mangled: Some(mangled.clone()),
            });
            self.mangled_props.put(ref_, mangled)?;
        }

        // The input entries in key order, then this build's new names in
        // assignment order.
        let mut input: Vec<(&[u8], &Option<Box<[u8]>>)> =
            options.cache.iter().map(|(k, v)| (&**k, v)).collect();
        input.sort_unstable_by(|a, b| a.0.cmp(b.0));
        let mut cache = Vec::with_capacity(input.len() + generated.len());
        cache.extend(
            input
                .into_iter()
                .map(|(original, mangled)| MangleCacheEntry {
                    original: original.into(),
                    mangled: mangled.clone(),
                }),
        );
        cache.extend(generated);
        self.mangle_cache = Some(cache);
        Ok(())
    }
}
