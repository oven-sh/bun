use core::fmt::Arguments;

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_collections::ArrayHashMap;

use crate as css;

// ─────────────────────────────────────────────────────────────────────────
// `reference_dashed`'s `dest.importRecord()` lookup is hoisted to the caller (see the comment
// on the method) to satisfy Rust borrowck (caller holds `&mut dest.css_module`).
// ─────────────────────────────────────────────────────────────────────────
pub struct CssModule<'a> {
    pub(crate) config: &'a Config,
    pub(crate) sources: &'a Vec<Box<[u8]>>,
    pub(crate) hashes: BumpVec<'a, &'a [u8]>,
    pub(crate) exports_by_source_index: BumpVec<'a, CssModuleExports<'a>>,
    pub(crate) references: &'a mut CssModuleReferences<'a>,
}

impl<'a> CssModule<'a> {
    pub(crate) fn new(
        bump: &'a Bump,
        config: &'a Config,
        sources: &'a Vec<Box<[u8]>>,
        project_root: Option<&[u8]>,
        references: &'a mut CssModuleReferences<'a>,
    ) -> CssModule<'a> {
        // TODO: this is BAAAAAAAAAAD we are going to remove it
        let hashes = 'hashes: {
            let mut hashes = BumpVec::with_capacity_in(sources.len(), bump);
            for path in sources.iter() {
                let mut alloced = false;
                let source: &[u8] = 'source: {
                    // Make paths relative to project root so hashes are stable
                    if let Some(root) = project_root {
                        if bun_paths::is_absolute(root) {
                            alloced = true;
                            break 'source bump.alloc_slice_copy(
                                bun_paths::resolve_path::relative(root, path.as_ref()),
                            );
                        }
                    }
                    break 'source path.as_ref();
                };
                // `source` is arena-allocated, bulk-freed on bump.reset()
                let _ = alloced;
                hashes.push(hash(
                    bump,
                    format_args!("{}", bstr::BStr::new(source)),
                    matches!(config.pattern.segments.at(0), Segment::Hash),
                ));
            }
            break 'hashes hashes;
        };
        let exports_by_source_index = 'exports_by_source_index: {
            let mut exports_by_source_index = BumpVec::with_capacity_in(sources.len(), bump);
            for _ in 0..sources.len() {
                exports_by_source_index.push(CssModuleExports::default());
            }
            break 'exports_by_source_index exports_by_source_index;
        };
        CssModule {
            config,
            sources,
            references,
            hashes,
            exports_by_source_index,
        }
    }

    pub(crate) fn get_reference(&mut self, bump: &'a Bump, name: &'a [u8], source_index: u32) {
        // bun_collections::ArrayHashMap::get_or_put requires `V: Default`
        // (CssModuleExport can't be Default — BumpVec field), so use the
        // entry()-API instead.
        use bun_collections::array_hash_map::MapEntry;
        match self.exports_by_source_index[source_index as usize].entry(name) {
            MapEntry::Occupied(mut o) => {
                o.get_mut().is_referenced = true;
            }
            MapEntry::Vacant(v) => {
                v.insert(CssModuleExport {
                    name: self.config.pattern.write_to_string(
                        bump,
                        BumpVec::new_in(bump),
                        self.hashes[source_index as usize],
                        self.sources[source_index as usize].as_ref(),
                        name,
                    ),
                    is_referenced: true,
                });
            }
        }
    }

    // This does not take `&mut Printer`: the only
    // caller (`DashedIdentReference::to_css`) already holds a `&mut` borrow of
    // `dest.css_module` (which *is* `self`), so threading `&mut Printer` in
    // here would alias. The caller pre-resolves the import-record path and
    // hands it down as `specifier_path`; the fallible `importRecord` lookup
    // therefore lives at the call site, which is why this no longer returns
    // `Result<_, PrintErr>`.
    pub(crate) fn reference_dashed(
        &mut self,
        bump: &'a Bump,
        name: &'a [u8],
        from: Option<css::css_properties::css_modules::Specifier>,
        specifier_path: Option<&'a [u8]>,
        source_index: u32,
    ) -> Option<&'a [u8]> {
        use css::css_properties::css_modules::Specifier;
        let (reference, key): (CssModuleReference<'a>, &'a [u8]) = match from {
            Some(Specifier::Global) => return Some(&name[2..]),
            Some(Specifier::ImportRecordIndex(_)) => {
                let path = specifier_path
                    .expect("specifier_path required for Specifier::ImportRecordIndex");
                (
                    CssModuleReference::Dependency {
                        name: &name[2..],
                        specifier: path,
                    },
                    path,
                )
            }
            None => {
                // Local export. Mark as used.
                // `CssModuleExport` cannot be `Default` (BumpVec field),
                // so use the `entry()` API like `get_reference` above.
                use bun_collections::array_hash_map::MapEntry;
                match self.exports_by_source_index[source_index as usize].entry(name) {
                    MapEntry::Occupied(mut o) => {
                        o.get_mut().is_referenced = true;
                    }
                    MapEntry::Vacant(v) => {
                        let mut res = BumpVec::new_in(bump);
                        res.extend_from_slice(b"--");
                        v.insert(CssModuleExport {
                            name: self.config.pattern.write_to_string(
                                bump,
                                res,
                                self.hashes[source_index as usize],
                                self.sources[source_index as usize].as_ref(),
                                &name[2..],
                            ),
                            is_referenced: true,
                        });
                    }
                }
                return None;
            }
        };

        let the_hash = hash(
            bump,
            format_args!(
                "{}_{}_{}",
                bstr::BStr::new(self.hashes[source_index as usize]),
                bstr::BStr::new(name),
                bstr::BStr::new(key)
            ),
            false,
        );

        // Build `--{the_hash}` as a bump Vec — a plain concat
        // (`bumpalo::Vec<u8>` lacks `io::Write`, and no formatting is needed).
        let mut k = BumpVec::with_capacity_in(2 + the_hash.len(), bump);
        k.extend_from_slice(b"--");
        k.extend_from_slice(the_hash);
        let _ = self.references.put(k.into_bump_slice(), reference);

        Some(the_hash)
    }

    pub(crate) fn handle_composes(
        &mut self,
        dest: &mut css::Printer<'a>,
        selectors: &css::selector::parser::SelectorList,
        composes: &css::css_properties::css_modules::Composes,
        source_index: u32,
    ) -> css::Maybe<(), css::PrinterErrorKind> {
        use bun_collections::array_hash_map::MapEntry;
        use css::css_properties::css_modules::Specifier;

        let bump = dest.arena;
        for sel in selectors.v.slice() {
            if sel.len() == 1 {
                if let css::selector::parser::Component::Class(id) = &sel.components[0] {
                    let id: &'a [u8] = dest.lookup_ident_or_ref(*id);
                    for name in composes.names.slice() {
                        let name_bytes: &'a [u8] = bump.alloc_slice_copy(name.v());
                        let reference = match &composes.from {
                            None => CssModuleReference::Local {
                                name: self.config.pattern.write_to_string(
                                    bump,
                                    BumpVec::new_in(bump),
                                    self.hashes[source_index as usize],
                                    self.sources[source_index as usize].as_ref(),
                                    name_bytes,
                                ),
                            },
                            Some(Specifier::Global) => {
                                CssModuleReference::Global { name: name_bytes }
                            }
                            Some(Specifier::ImportRecordIndex(idx)) => {
                                let Some(import_info) = &dest.import_info else {
                                    return Err(css::PrinterErrorKind::no_import_records);
                                };
                                let path = import_info.import_records[*idx as usize].path.text;
                                CssModuleReference::Dependency {
                                    name: name_bytes,
                                    specifier: bump.alloc_slice_copy(path),
                                }
                            }
                        };

                        let export =
                            match self.exports_by_source_index[source_index as usize].entry(id) {
                                MapEntry::Occupied(o) => o.into_mut(),
                                MapEntry::Vacant(v) => v.insert(CssModuleExport {
                                    name: self.config.pattern.write_to_string(
                                        bump,
                                        BumpVec::new_in(bump),
                                        self.hashes[source_index as usize],
                                        self.sources[source_index as usize].as_ref(),
                                        id,
                                    ),
                                    composes: BumpVec::new_in(bump),
                                    is_referenced: false,
                                }),
                            };
                        if !export.composes.iter().any(|r| r.eql(&reference)) {
                            export.composes.push(reference);
                        }
                    }
                    continue;
                }
            }

            // The composes property can only be used within a simple class selector.
            return Err(css::PrinterErrorKind::invalid_composes_selector);
        }

        Ok(())
    }

    pub(crate) fn add_dashed(&mut self, bump: &'a Bump, local: &'a [u8], source_index: u32) {
        use bun_collections::array_hash_map::MapEntry;
        if let MapEntry::Vacant(v) =
            self.exports_by_source_index[source_index as usize].entry(local)
        {
            v.insert(CssModuleExport {
                // todo_stuff.depth
                name: self.config.pattern.write_to_string_with_prefix(
                    bump,
                    b"--",
                    self.hashes[source_index as usize],
                    self.sources[source_index as usize].as_ref(),
                    &local[2..],
                ),
                is_referenced: false,
            });
        }
    }

    pub(crate) fn add_local(
        &mut self,
        bump: &'a Bump,
        exported: &'a [u8],
        local: &'a [u8],
        source_index: u32,
    ) {
        use bun_collections::array_hash_map::MapEntry;
        if let MapEntry::Vacant(v) =
            self.exports_by_source_index[source_index as usize].entry(exported)
        {
            v.insert(CssModuleExport {
                // todo_stuff.depth
                name: self.config.pattern.write_to_string(
                    bump,
                    BumpVec::new_in(bump),
                    self.hashes[source_index as usize],
                    self.sources[source_index as usize].as_ref(),
                    local,
                ),
                is_referenced: false,
            });
        }
    }
}

/// Configuration for CSS modules.
pub struct Config {
    /// The name pattern to use when renaming class names and other identifiers.
    /// Default is `[hash]_[local]`.
    pub(crate) pattern: Pattern,

    /// Whether to rename dashed identifiers, e.g. custom properties.
    pub(crate) dashed_idents: bool,

    /// Whether to scope animation names.
    /// Default is `true`.
    pub(crate) animation: bool,

    /// Whether to scope custom identifiers
    /// Default is `true`.
    pub(crate) custom_idents: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            pattern: Pattern::default(),
            dashed_idents: false,
            animation: true,
            custom_idents: true,
        }
    }
}

/// A CSS modules class name pattern.
pub struct Pattern {
    /// The list of segments in the pattern.
    pub(crate) segments: crate::SmallList<Segment, 3>,
}

impl Default for Pattern {
    fn default() -> Self {
        Self {
            segments: crate::SmallList::init_inlined(&[
                Segment::Local,
                Segment::Literal(b"_"),
                Segment::Hash,
            ]),
        }
    }
}

impl Pattern {
    /// Write the substituted pattern to a destination.
    pub(crate) fn write(
        &self,
        hash_: &[u8],
        path: &[u8],
        local: &[u8],
        mut writefn: impl FnMut(&[u8], /* replace_dots: */ bool),
    ) {
        for segment in self.segments.slice() {
            match segment {
                Segment::Literal(s) => {
                    writefn(s, false);
                }
                Segment::Name => {
                    let stem = bun_paths::stem(path);
                    if bun_core::index_of(stem, b".").is_some() {
                        writefn(stem, true);
                    } else {
                        writefn(stem, false);
                    }
                }
                Segment::Local => {
                    writefn(local, false);
                }
                Segment::Hash => {
                    writefn(hash_, false);
                }
            }
        }
    }

    pub(crate) fn write_to_string_with_prefix<'a>(
        &self,
        bump: &'a Bump,
        prefix: &'static [u8],
        hash_: &[u8],
        path: &[u8],
        local: &[u8],
    ) -> &'a [u8] {
        let mut res: BumpVec<'a, u8> = BumpVec::new_in(bump);
        self.write(hash_, path, local, |slice: &[u8], replace_dots: bool| {
            res.extend_from_slice(prefix);
            if replace_dots {
                let start = res.len();
                res.extend_from_slice(slice);
                let end = res.len();
                for c in &mut res[start..end] {
                    if *c == b'.' {
                        *c = b'-';
                    }
                }
                return;
            }
            res.extend_from_slice(slice);
        });
        res.into_bump_slice()
    }

    pub(crate) fn write_to_string<'a>(
        &self,
        _bump: &'a Bump,
        res_: BumpVec<'a, u8>,
        hash_: &[u8],
        path: &[u8],
        local: &[u8],
    ) -> &'a [u8] {
        let mut res = res_;
        self.write(hash_, path, local, |slice: &[u8], replace_dots: bool| {
            if replace_dots {
                let start = res.len();
                res.extend_from_slice(slice);
                let end = res.len();
                for c in &mut res[start..end] {
                    if *c == b'.' {
                        *c = b'-';
                    }
                }
                return;
            }
            res.extend_from_slice(slice);
        });

        res.into_bump_slice()
    }
}

/// A segment in a CSS modules class name pattern.
///
/// See [Pattern](Pattern).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Segment {
    /// A literal string segment.
    Literal(&'static [u8]),

    /// The base file name.
    Name,

    /// The original class name.
    Local,

    /// A hash of the file name.
    Hash,
}

/// A map of exported names to values.
pub type CssModuleExports<'a> = ArrayHashMap<&'a [u8], CssModuleExport<'a>>;

/// A map of placeholders to references.
pub type CssModuleReferences<'a> = ArrayHashMap<&'a [u8], CssModuleReference<'a>>;

/// An exported value from a CSS module.
pub struct CssModuleExport<'a> {
    /// The local (compiled) name for this export.
    pub name: &'a [u8],
    /// Whether the export is referenced in this file.
    pub(crate) is_referenced: bool,
}

/// A referenced name within a CSS module, e.g. via the `composes` property.
///
/// See [CssModuleExport](CssModuleExport).
pub enum CssModuleReference<'a> {
    /// A reference to an export in a different file.
    Dependency {
        /// The name to reference within the dependency.
        name: &'a [u8],
        /// The dependency specifier for the referenced file.
        ///
        /// import record idx
        specifier: &'a [u8],
    },
}

/// LAYERING: canonical implementation lives in `bun_base64::wyhash_url_safe`
/// (a leaf crate) so `bun_bundler::LinkerContext::mangle_local_css` can call
/// the *same* hasher without depending on `bun_css`. Re-export here so
/// in-crate callers (`dependencies.rs`, `rules/import.rs`) keep the
/// `css_modules::hash` path.
#[inline]
pub(crate) fn hash<'a>(bump: &'a Bump, args: Arguments<'_>, at_start: bool) -> &'a [u8] {
    bun_base64::wyhash_url_safe(bump, args, at_start)
}
