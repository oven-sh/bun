use core::fmt::Arguments;

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVec as BumpVec;

use crate as css;

pub struct CssModule<'a> {
    pub(crate) config: &'a Config,
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
        CssModule { config, hashes }
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
}

/// Configuration for CSS modules.
pub struct Config {
    /// The name pattern to use when renaming class names and other identifiers.
    /// Default is `[hash]_[local]`.
    pub(crate) pattern: Pattern,

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
    pub(crate) fn write(&self, hash_: &[u8], local: &[u8], mut writefn: impl FnMut(&[u8])) {
        for segment in self.segments.slice() {
            match segment {
                Segment::Literal(s) => {
                    writefn(s);
                }
                Segment::Local => {
                    writefn(local);
                }
                Segment::Hash => {
                    writefn(hash_);
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

    /// The original class name.
    Local,

    /// A hash of the file name.
    Hash,
}

/// LAYERING: canonical implementation lives in `bun_base64::wyhash_url_safe`
/// (a leaf crate) so `bun_bundler::LinkerContext::mangle_local_css` can call
/// the *same* hasher without depending on `bun_css`. Re-export here so
/// in-crate callers keep the `css_modules::hash` path.
#[inline]
pub(crate) fn hash<'a>(bump: &'a Bump, args: Arguments<'_>, at_start: bool) -> &'a [u8] {
    bun_base64::wyhash_url_safe(bump, args, at_start)
}
