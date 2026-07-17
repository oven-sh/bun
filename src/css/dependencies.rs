//! CSS dependency tracking — `@import` and `url()` references collected during printing.

use crate::SourceLocation;

/// Options for `analyze_dependencies` in `PrinterOptions`.
pub struct DependencyOptions {
    /// Whether to remove `@import` rules.
    pub remove_imports: bool,
}

/// A dependency.
pub enum Dependency {
    /// An `@import` dependency.
    Import(ImportDependency),
    /// A `url()` dependency.
    Url(UrlDependency),
}

/// A line and column position within a source file.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Location {
    /// The line number, starting from 1.
    pub line: u32,
    /// The column number, starting from 1.
    pub column: u32,
}

impl Location {
    pub fn from_source_location(loc: SourceLocation) -> Location {
        Location {
            line: loc.line + 1,
            column: loc.column,
        }
    }
}

/// An `@import` dependency.
pub struct ImportDependency {
    /// The url to import.
    // Lifetime: arena-borrowed from `rule.url` (CSS arena); valid until the arena is reset.
    pub url: *const [u8],
    /// The placeholder that the URL was replaced with.
    // Lifetime: arena-allocated by `css_modules::hash`.
    pub placeholder: *const [u8],
    /// An optional `supports()` condition.
    // Lifetime: arena-allocated by `to_css::string`.
    pub supports: Option<*const [u8]>,
    /// A media query.
    // Lifetime: arena-allocated by `to_css::string`.
    pub media: Option<*const [u8]>,
    /// The location of the dependency in the source file.
    pub loc: SourceRange,
}

impl ImportDependency {
    pub fn new<'bump>(
        bump: &'bump bun_alloc::Arena,
        rule: &crate::css_rules::import::ImportRule,
        filename: &[u8],
        local_names: Option<&crate::LocalsResultsMap>,
        symbols: &bun_ast::symbol::Map,
    ) -> ImportDependency {
        let supports: Option<*const [u8]> = if let Some(supports) = &rule.supports {
            let s = crate::to_css::string(
                bump,
                supports,
                &crate::PrinterOptions::default(),
                None,
                local_names,
                symbols,
            )
            .unwrap_or_else(|_| {
                panic!(
                    "Unreachable code: failed to stringify SupportsCondition.\n\n\
                     This is a bug in Bun's CSS printer. Please file a bug report at \
                     https://github.com/oven-sh/bun/issues/new/choose"
                )
            });
            Some(std::ptr::from_ref::<[u8]>(bump.alloc_slice_copy(&s)))
        } else {
            None
        };

        let media: Option<*const [u8]> = if !rule.media.media_queries.is_empty() {
            let s = crate::to_css::string(
                bump,
                &rule.media,
                &crate::PrinterOptions::default(),
                None,
                local_names,
                symbols,
            )
            .unwrap_or_else(|_| {
                panic!(
                    "Unreachable code: failed to stringify MediaList.\n\n\
                     This is a bug in Bun's CSS printer. Please file a bug report at \
                     https://github.com/oven-sh/bun/issues/new/choose"
                )
            });
            Some(std::ptr::from_ref::<[u8]>(bump.alloc_slice_copy(&s)))
        } else {
            None
        };

        let placeholder = crate::css_modules::hash(
            bump,
            format_args!(
                "{}_{}",
                bstr::BStr::new(filename),
                bstr::BStr::new(rule.url)
            ),
            false,
        );

        ImportDependency {
            // lightningcss clones this; we borrow from the arena instead.
            url: std::ptr::from_ref::<[u8]>(rule.url),
            placeholder: std::ptr::from_ref::<[u8]>(placeholder),
            supports,
            media,
            loc: SourceRange::new(
                filename,
                Location {
                    line: rule.loc.line + 1,
                    column: rule.loc.column,
                },
                // Assumes the `@import "url"` form: 8 = len of `@import `, +2 for the
                // quotes. The `@import url(...)` form yields a slightly-off range —
                // a limitation inherited from lightningcss.
                8,
                rule.url.len() + 2,
            ),
        }
    }
}

/// A `url()` dependency.
pub struct UrlDependency {
    /// The url of the dependency.
    // Lifetime: arena-borrowed from `import_records[..].path.pretty`.
    pub url: *const [u8],
    /// The placeholder that the URL was replaced with.
    // Lifetime: arena-allocated by `css_modules::hash`.
    pub placeholder: *const [u8],
    /// The location of the dependency in the source file.
    pub loc: SourceRange,
}

impl UrlDependency {
    pub fn new<'bump>(
        bump: &'bump bun_alloc::Arena,
        url: &crate::values::url::Url,
        filename: &[u8],
        import_records: &[bun_ast::ImportRecord],
    ) -> UrlDependency {
        let theurl: &[u8] = import_records[url.import_record_idx as usize].path.pretty;
        let placeholder = crate::css_modules::hash(
            bump,
            format_args!("{}_{}", bstr::BStr::new(filename), bstr::BStr::new(theurl)),
            false,
        );
        UrlDependency {
            url: std::ptr::from_ref::<[u8]>(theurl),
            placeholder: std::ptr::from_ref::<[u8]>(placeholder),
            loc: SourceRange::new(filename, url.loc, 4, theurl.len()),
        }
    }
}

/// Represents the range of source code where a dependency was found.
pub struct SourceRange {
    /// The filename in which the dependency was found.
    // Lifetime: borrowed from the caller (printer's filename); arena- or statically-backed.
    pub file_path: *const [u8],
    /// The starting line and column position of the dependency.
    pub start: Location,
    /// The ending line and column position of the dependency.
    pub end: Location,
}

impl SourceRange {
    pub fn new(filename: &[u8], loc: Location, offset: u32, len: usize) -> SourceRange {
        SourceRange {
            file_path: std::ptr::from_ref::<[u8]>(filename),
            start: Location {
                line: loc.line,
                column: loc.column + offset,
            },
            end: Location {
                line: loc.line,
                column: loc.column + offset + u32::try_from(len).expect("int cast") - 1,
            },
        }
    }
}
