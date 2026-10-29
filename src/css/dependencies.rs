//! CSS dependency tracking — `@import` and `url()` references collected during printing.

use crate::SourceLocation;

/// Options for `analyze_dependencies` in `PrinterOptions`.
pub struct DependencyOptions {
    /// Whether to remove `@import` rules.
    pub(crate) remove_imports: bool,
}

/// A dependency.
pub enum Dependency<'bump> {
    /// An `@import` dependency.
    Import(ImportDependency<'bump>),
    /// A `url()` dependency.
    Url(UrlDependency<'bump>),
}

/// A line and column position within a source file.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Location {
    /// The line number, starting from 1.
    pub(crate) line: u32,
    /// The column number, starting from 1.
    pub(crate) column: u32,
}

impl Location {
    pub(crate) fn from_source_location(loc: SourceLocation) -> Location {
        Location {
            line: loc.line + 1,
            column: loc.column,
        }
    }
}

/// An `@import` dependency.
pub struct ImportDependency<'bump> {
    /// The placeholder that the URL was replaced with.
    // Lifetime: arena-allocated by `css_modules::hash`.
    pub(crate) placeholder: &'bump [u8],
}

impl<'bump> ImportDependency<'bump> {
    pub(crate) fn new(
        bump: &'bump bun_alloc::Arena,
        rule: &crate::css_rules::import::ImportRule,
        filename: &[u8],
    ) -> ImportDependency<'bump> {
        let placeholder = crate::css_modules::hash(
            bump,
            format_args!(
                "{}_{}",
                bstr::BStr::new(filename),
                bstr::BStr::new(rule.url)
            ),
            false,
        );

        ImportDependency { placeholder }
    }
}

/// A `url()` dependency.
pub struct UrlDependency<'bump> {
    /// The placeholder that the URL was replaced with.
    // Lifetime: arena-allocated by `css_modules::hash`.
    pub(crate) placeholder: &'bump [u8],
}

impl<'bump> UrlDependency<'bump> {
    pub(crate) fn new(
        bump: &'bump bun_alloc::Arena,
        url: &crate::values::url::Url,
        filename: &[u8],
        import_records: &[bun_ast::ImportRecord],
    ) -> UrlDependency<'bump> {
        let theurl: &[u8] = import_records[url.import_record_idx as usize].path.pretty;
        let placeholder = crate::css_modules::hash(
            bump,
            format_args!("{}_{}", bstr::BStr::new(filename), bstr::BStr::new(theurl)),
            false,
        );
        UrlDependency { placeholder }
    }
}
