use core::fmt::Arguments;

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};

use crate as css;
pub use crate::Error;

// ─────────────────────────────────────────────────────────────────────────
// `reference_dashed`'s `dest.importRecord()` lookup is hoisted to the caller (see the comment
// on the method) to satisfy Rust borrowck (caller holds `&mut dest.css_module`).
// ─────────────────────────────────────────────────────────────────────────
pub struct CssModule<'a> {
    pub config: &'a Config,
    pub sources: &'a Vec<Box<[u8]>>,
    pub hashes: BumpVec<'a, &'a [u8]>,
}

impl<'a> CssModule<'a> {
    pub fn new(
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

    // This does not take `&mut Printer`: the only
    // caller (`DashedIdentReference::to_css`) already holds a `&mut` borrow of
    // `dest.css_module` (which *is* `self`), so threading `&mut Printer` in
    // here would alias. The caller pre-resolves the import-record path and
    // hands it down as `specifier_path`; the fallible `importRecord` lookup
    // therefore lives at the call site, which is why this no longer returns
    // `Result<_, PrintErr>`.
    pub fn reference_dashed(
        &mut self,
        bump: &'a Bump,
        name: &'a [u8],
        from: Option<css::css_properties::css_modules::Specifier>,
        specifier_path: Option<&'a [u8]>,
        source_index: u32,
    ) -> Option<&'a [u8]> {
        use css::css_properties::css_modules::Specifier;
        let key: &'a [u8] = match from {
            Some(Specifier::Global) => return Some(&name[2..]),
            Some(Specifier::ImportRecordIndex(_)) => specifier_path
                .expect("specifier_path required for Specifier::ImportRecordIndex"),
            // Local dashed ident: written unmangled.
            None => return None,
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
    pub fn handle_composes(
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

}

/// Configuration for CSS modules.
pub struct Config {
    /// The name pattern to use when renaming class names and other identifiers.
    /// Default is `[hash]_[local]`.
    pub pattern: Pattern,

    /// Whether to rename dashed identifiers, e.g. custom properties.
    pub dashed_idents: bool,

    /// Whether to scope animation names.
    /// Default is `true`.
    pub animation: bool,

    /// Whether to scope grid names.
    /// Default is `true`.
    pub grid: bool,

    /// Whether to scope custom identifiers
    /// Default is `true`.
    pub custom_idents: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            pattern: Pattern::default(),
            dashed_idents: false,
            animation: true,
            grid: true,
            custom_idents: true,
        }
    }
}

/// A CSS modules class name pattern.
pub struct Pattern {
    /// The list of segments in the pattern.
    pub segments: crate::SmallList<Segment, 3>,
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
    pub fn write(
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

    pub fn write_to_string_with_prefix<'a>(
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

    pub fn write_to_string<'a>(
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

/// LAYERING: canonical implementation lives in `bun_base64::wyhash_url_safe`
/// (a leaf crate) so `bun_bundler::LinkerContext::mangle_local_css` can call
/// the *same* hasher without depending on `bun_css`. Re-export here so
/// in-crate callers (`dependencies.rs`, `rules/import.rs`) keep the
/// `css_modules::hash` path.
#[inline]
pub fn hash<'a>(bump: &'a Bump, args: Arguments<'_>, at_start: bool) -> &'a [u8] {
    bun_base64::wyhash_url_safe(bump, args, at_start)
}
