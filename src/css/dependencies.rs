//! CSS dependency tracking — `@import` and `url()` references collected during printing.

use crate::SourceLocation;

/// Options for `analyze_dependencies` in `PrinterOptions`.
pub struct DependencyOptions {
    /// Whether to remove `@import` rules.
    pub(crate) remove_imports: bool,
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
pub struct ImportDependency {
    /// The placeholder that the URL was replaced with.
    // Lifetime: arena-allocated by `css_modules::hash`.
    pub(crate) placeholder: *const [u8],
}

impl ImportDependency {
    pub(crate) fn new<'bump>(
        bump: &'bump bun_alloc::Arena,
        rule: &crate::css_rules::import::ImportRule,
        filename: &[u8],
    ) -> ImportDependency {
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
            placeholder: std::ptr::from_ref::<[u8]>(placeholder),
        }
    }
}

/// A `url()` dependency.
pub struct UrlDependency {
    /// The placeholder that the URL was replaced with.
    // Lifetime: arena-allocated by `css_modules::hash`.
    pub(crate) placeholder: *const [u8],
}

impl UrlDependency {
    pub(crate) fn new<'bump>(
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
            placeholder: std::ptr::from_ref::<[u8]>(placeholder),
        }
    }
}

