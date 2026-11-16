use core::fmt::Arguments;

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVec as BumpVec;
use bun_ast::{ImportRecord, Log, Range, Ref, Source};
use bun_collections::ArrayHashMap;
use bun_core::StackCheck;
use bun_core::fmt::quote;

use crate as css;
use css::css_parser::LocalEntry;
use css::css_properties::css_modules::{Composes, Specifier};
use css::{BundlerStyleSheet, CssRef};

pub struct CssModule<'a> {
    pub(crate) config: &'a Config,
    pub(crate) sources: &'a Vec<Box<[u8]>>,
    pub(crate) hashes: BumpVec<'a, &'a [u8]>,
}

impl<'a> CssModule<'a> {
    pub(crate) fn new(
        bump: &'a Bump,
        config: &'a Config,
        sources: &'a Vec<Box<[u8]>>,
        project_root: Option<&[u8]>,
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
        CssModule {
            config,
            sources,
            hashes,
        }
    }

    /// `specifier_path` is the path of the import record that `from` names.
    pub(crate) fn reference_dashed<'s>(
        &self,
        bump: &'s Bump,
        name: &'s [u8],
        from: Option<css::css_properties::css_modules::Specifier>,
        specifier_path: Option<&[u8]>,
        source_index: u32,
    ) -> Option<&'s [u8]> {
        let key = match from? {
            Specifier::Global => return Some(&name[2..]),
            Specifier::ImportRecordIndex(_) => {
                specifier_path.expect("specifier_path required for Specifier::ImportRecordIndex")
            }
        };

        Some(hash(
            bump,
            format_args!(
                "{}_{}_{}",
                bstr::BStr::new(self.hashes[source_index as usize]),
                bstr::BStr::new(name),
                bstr::BStr::new(key)
            ),
            false,
        ))
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

#[inline]
fn hash<'a>(bump: &'a Bump, args: Arguments<'_>, at_start: bool) -> &'a [u8] {
    bun_base64::wyhash_url_safe(bump, args, at_start)
}

pub fn is_module_path(path: &[u8]) -> bool {
    const SUFFIX: &[u8] = b".module.css";
    path.len() > SUFFIX.len() && path.ends_with(SUFFIX)
}

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
    Local(Ref),
    Global(&'a [u8]),
}

pub trait ComposesGraph<'bump> {
    fn stylesheet(&self, source_index: u32) -> Option<&BundlerStyleSheet<'bump>>;
    fn source(&self, source_index: u32) -> &Source<'_>;
    fn import_record(&self, source_index: u32, import_record_index: u32) -> &ImportRecord<'_>;
}

pub struct ComposesVisitor<'a, 'bump> {
    graph: &'a dyn ComposesGraph<'bump>,
    visited: ArrayHashMap<Ref, ()>,
    names: Vec<ExportedName<'bump>>,
    stack_check: StackCheck,
    pub out_of_stack: bool,
}

impl<'a, 'bump> ComposesVisitor<'a, 'bump> {
    pub fn new(graph: &'a dyn ComposesGraph<'bump>) -> Self {
        Self {
            graph,
            visited: ArrayHashMap::new(),
            names: Vec::new(),
            stack_check: StackCheck::init(),
            out_of_stack: false,
        }
    }

    /// Returns the classes `local` composes first, then `local` itself.
    pub fn exported_names(
        &mut self,
        sheet: &BundlerStyleSheet<'bump>,
        local: CssRef,
        source_index: u32,
        log: &mut Log,
    ) -> &[ExportedName<'bump>] {
        self.visited.clear_retaining_capacity();
        self.names.clear();
        self.visit_local(sheet, local, source_index, log);
        &self.names
    }

    fn visit_local(
        &mut self,
        sheet: &BundlerStyleSheet<'bump>,
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
        sheet: &BundlerStyleSheet<'bump>,
        compose: &Composes<'bump>,
        source_index: u32,
        log: &mut Log,
    ) {
        if !self.stack_check.is_safe_to_recurse() {
            self.out_of_stack = true;
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
                    if let Some(other) = other_sheet.local_scope.get(name.v) {
                        self.visit_composed(other_sheet, name.v, other, other_index, compose, log);
                    }
                }
            }
            // `foo` in `composes: foo from global` is not renamed
            Some(Specifier::Global) => {
                for name in compose.names.slice() {
                    self.names.push(ExportedName::Global(name.v));
                }
            }
            // it is from the current file
            None => {
                for name in compose.names.slice() {
                    let Some(local) = sheet.local_scope.get(name.v) else {
                        log.add_error_fmt(
                            self.graph.source(source_index),
                            compose.loc,
                            format_args!(
                                "The name {} never appears in {} as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                quote(name.v),
                                quote(self.graph.source(source_index).path.pretty),
                            ),
                        );
                        continue;
                    };
                    self.visit_composed(sheet, name.v, local, source_index, compose, log);
                }
            }
        }
    }

    fn visit_composed(
        &mut self,
        sheet: &BundlerStyleSheet<'bump>,
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
