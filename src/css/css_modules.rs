use core::fmt::Arguments;

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::{ImportRecord, Log, Range, Ref, Source};
use bun_collections::ArrayHashMap;
use bun_core::StackCheck;
use bun_core::fmt::quote;

use crate as css;
use css::css_parser::LocalEntry;
use css::css_properties::css_modules::{Composes, Specifier};
use css::{BundlerStyleSheet, CssRef};

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
        _dest: &mut css::Printer,
        selectors: &css::selector::parser::SelectorList,
        _composes: &css::css_properties::css_modules::Composes,
        _source_index: u32,
    ) -> css::Maybe<(), css::PrinterErrorKind> {
        // let bump = dest.arena;
        for sel in selectors.v.slice() {
            if sel.len() == 1
                && matches!(
                    sel.components[0],
                    css::selector::parser::Component::Class(_)
                )
            {
                continue;
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

#[inline]
pub(crate) fn hash<'a>(bump: &'a Bump, args: Arguments<'_>, at_start: bool) -> &'a [u8] {
    bun_base64::wyhash_url_safe(bump, args, at_start)
}

/// Whether the file at `path` is a CSS module.
pub fn is_module_path(path: &[u8]) -> bool {
    const SUFFIX: &[u8] = b".module.css";
    path.len() > SUFFIX.len() && path.ends_with(SUFFIX)
}

/// The name that `local`, a class or id of the CSS module at `pretty_path`, is renamed to.
pub fn scoped_name(scratch: &Bump, pretty_path: &[u8], local: &[u8]) -> Box<[u8]> {
    use std::io::Write as _;
    let path_hash = hash(
        scratch,
        // use path relative to cwd for determinism
        format_args!("{}", bstr::BStr::new(pretty_path)),
        false,
    );
    let mut name = Vec::<u8>::new();
    write!(
        &mut name,
        "{}_{}",
        bstr::BStr::new(local),
        bstr::BStr::new(path_hash)
    )
    .expect("infallible: in-memory write");
    name.into_boxed_slice()
}

/// One of the space-separated names in the string a CSS module exports for a local.
#[derive(Clone, Copy)]
pub enum ExportedName<'a> {
    /// A local of the file `Ref::source_index`, exported as its scoped name.
    Local(Ref),
    /// `composes: name from global`, exported as written.
    Global(&'a [u8]),
}

/// The files that `composes: name from "file"` can reach, by source index.
pub trait ComposesGraph {
    /// `None` when the file is not CSS.
    fn stylesheet(&self, source_index: u32) -> Option<&BundlerStyleSheet>;
    fn source(&self, source_index: u32) -> &Source;
    fn import_record(&self, source_index: u32, import_record_index: u32) -> &ImportRecord;
}

/// Follows `composes` to find what a CSS module exports for each of its locals.
pub struct ComposesVisitor<'a> {
    graph: &'a dyn ComposesGraph,
    visited: ArrayHashMap<Ref, ()>,
    names: Vec<ExportedName<'a>>,
    stack_check: StackCheck,
}

impl<'a> ComposesVisitor<'a> {
    pub fn new(graph: &'a dyn ComposesGraph) -> Self {
        Self {
            graph,
            visited: ArrayHashMap::new(),
            names: Vec::new(),
            stack_check: StackCheck::init(),
        }
    }

    /// What `sheet`, the file `source_index`, exports for `local`: the classes it composes, then `local`.
    pub fn exported_names(
        &mut self,
        sheet: &'a BundlerStyleSheet,
        local: CssRef,
        source_index: u32,
        log: &mut Log,
    ) -> &[ExportedName<'a>] {
        self.visited.clear_retaining_capacity();
        self.names.clear();
        self.visit_local(sheet, local, source_index, log);
        &self.names
    }

    fn visit_local(
        &mut self,
        sheet: &'a BundlerStyleSheet,
        local: CssRef,
        source_index: u32,
        log: &mut Log,
    ) {
        let ref_ = local.to_real_ref(source_index);
        if self.visited.insert(ref_, ()).is_some() {
            return;
        }
        if let Some(entry) = sheet.composes.get(&ref_) {
            // while parsing we check that we only allow `composes` on single class selectors
            debug_assert!(local.can_be_composed());
            for compose in &entry.composes {
                self.visit_compose(sheet, compose, source_index, log);
            }
        }
        self.names.push(ExportedName::Local(ref_));
    }

    fn visit_compose(
        &mut self,
        sheet: &'a BundlerStyleSheet,
        compose: &'a Composes,
        source_index: u32,
        log: &mut Log,
    ) {
        if !self.stack_check.is_safe_to_recurse() {
            log.add_error_fmt(
                self.graph.source(source_index),
                compose.loc,
                format_args!("Maximum \"composes\" depth exceeded"),
            );
            return;
        }
        match compose.from {
            // it is imported
            Some(Specifier::ImportRecordIndex(import_record_index)) => {
                let other_index = self
                    .graph
                    .import_record(source_index, import_record_index)
                    .source_index;
                if !other_index.is_valid() {
                    return;
                }
                let other_index = other_index.get();
                let Some(other_sheet) = self.graph.stylesheet(other_index) else {
                    log.add_error_fmt(
                        self.graph.source(source_index),
                        compose.loc,
                        format_args!(
                            "Cannot use the \"composes\" property with the {} file (it is not a CSS file)",
                            quote(self.graph.source(other_index).path.pretty),
                        ),
                    );
                    return;
                };
                for name in compose.names.slice() {
                    if let Some(other) = other_sheet.local_scope.get(name.v()) {
                        self.visit_composed(
                            other_sheet,
                            name.v(),
                            other,
                            other_index,
                            compose,
                            log,
                        );
                    }
                }
            }
            // `foo` in `composes: foo from global` is not renamed
            Some(Specifier::Global) => {
                for name in compose.names.slice() {
                    self.names.push(ExportedName::Global(name.v()));
                }
            }
            // it is from the current file
            None => {
                for name in compose.names.slice() {
                    let Some(local) = sheet.local_scope.get(name.v()) else {
                        log.add_error_fmt(
                            self.graph.source(source_index),
                            compose.loc,
                            format_args!(
                                "The name {} never appears in {} as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                quote(name.v()),
                                quote(self.graph.source(source_index).path.pretty),
                            ),
                        );
                        continue;
                    };
                    self.visit_composed(sheet, name.v(), local, source_index, compose, log);
                }
            }
        }
    }

    /// `compose` names `name`, which is `local` in `sheet`, the file `source_index`.
    fn visit_composed(
        &mut self,
        sheet: &'a BundlerStyleSheet,
        name: &[u8],
        local: &LocalEntry,
        source_index: u32,
        compose: &Composes,
        log: &mut Log,
    ) {
        if !local.ref_.can_be_composed() {
            log.add_range_error_fmt_with_note(
                Some(self.graph.source(source_index)),
                Range {
                    loc: compose.loc,
                    ..Default::default()
                },
                format_args!(
                    "The composes property cannot be used with {}, because it is not a single class name.",
                    quote(name),
                ),
                format_args!("The definition of {} is here.", quote(name)),
                Range {
                    loc: local.loc,
                    ..Default::default()
                },
            );
            return;
        }
        self.visit_local(sheet, local.ref_, source_index, log);
    }
}

/// Reports each `composes: name from "file"` in the file `source_index` whose `file` has no local `name`.
pub fn check_composes_from(graph: &impl ComposesGraph, source_index: u32, log: &mut Log) {
    let Some(sheet) = graph.stylesheet(source_index) else {
        return;
    };
    for compose in sheet.composes.values().iter().flat_map(|e| &e.composes) {
        let Some(Specifier::ImportRecordIndex(import_record_index)) = compose.from else {
            continue;
        };
        let other_index = graph
            .import_record(source_index, import_record_index)
            .source_index;
        if !other_index.is_valid() {
            continue;
        }
        let Some(other_sheet) = graph.stylesheet(other_index.get()) else {
            continue;
        };
        for name in compose.names.slice() {
            if !other_sheet.local_scope.contains(name.v()) {
                log.add_error_fmt(
                    graph.source(source_index),
                    compose.loc,
                    format_args!(
                        "The name {} never appears in {} as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                        quote(name.v()),
                        quote(graph.source(other_index.get()).path.pretty),
                    ),
                );
            }
        }
    }
}
