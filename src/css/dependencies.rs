//! CSS dependency tracking — `@import` and `url()` references collected during printing.

use bun_alloc::Arena; // = bumpalo::Bump
use bun_collections::BabyList;
use bun_options_types::ImportRecord;

pub use crate::css_parser as css;
pub use crate::values as css_values;
use css_values::url::Url;
pub use css::Error;
// const Location = css.Location; — shadowed by the local `Location` below in Zig too.

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
    pub fn from_source_location(loc: css::SourceLocation) -> Location {
        Location {
            line: loc.line + 1,
            column: loc.column,
        }
    }

    // PORT NOTE: Zig `hash` / `eql` methods called `css.implementHash` / `css.implementEql`
    // (comptime struct-field reflection). Replaced by `#[derive(Hash, PartialEq, Eq)]` above
    // per PORTING.md §Comptime reflection.
}

/// An `@import` dependency.
pub struct ImportDependency {
    /// The url to import.
    // TODO(port): lifetime — arena-borrowed from `rule.url` (CSS arena); Phase B may want `&'bump [u8]`.
    pub url: *const [u8],
    /// The placeholder that the URL was replaced with.
    // TODO(port): lifetime — arena-allocated by `css_modules::hash`.
    pub placeholder: *const [u8],
    /// An optional `supports()` condition.
    // TODO(port): lifetime — arena-allocated by `to_css::string`.
    pub supports: Option<*const [u8]>,
    /// A media query.
    // TODO(port): lifetime — arena-allocated by `to_css::string`.
    pub media: Option<*const [u8]>,
    /// The location of the dependency in the source file.
    pub loc: SourceRange,
}

impl ImportDependency {
    pub fn new<'bump>(
        bump: &'bump Arena,
        rule: &css::css_rules::import::ImportRule,
        filename: &[u8],
        local_names: Option<&css::LocalsResultsMap>,
        symbols: &bun_js_parser::symbol::Map,
    ) -> ImportDependency {
        let supports: Option<*const [u8]> = if let Some(supports) = &rule.supports {
            let s = css::to_css::string(
                bump,
                // Zig passed the type `css.css_rules.supports.SupportsCondition` as a comptime
                // param; in Rust the generic is inferred from `supports`.
                supports,
                css::PrinterOptions::default(),
                None,
                local_names,
                symbols,
            )
            .expect(
                "Unreachable code: failed to stringify SupportsCondition.\n\n\
                 This is a bug in Bun's CSS printer. Please file a bug report at \
                 https://github.com/oven-sh/bun/issues/new/choose",
            );
            Some(s as *const [u8])
        } else {
            None
        };

        let media: Option<*const [u8]> = if !rule.media.media_queries.is_empty() {
            let s = css::to_css::string(
                bump,
                &rule.media, // css::MediaList
                css::PrinterOptions::default(),
                None,
                local_names,
                symbols,
            )
            .expect(
                "Unreachable code: failed to stringify MediaList.\n\n\
                 This is a bug in Bun's CSS printer. Please file a bug report at \
                 https://github.com/oven-sh/bun/issues/new/choose",
            );
            Some(s as *const [u8])
        } else {
            None
        };

        let placeholder = css::css_modules::hash(
            bump,
            // TODO(port): Zig passed fmt string "{s}_{s}" + .{filename, rule.url}. Phase B:
            // confirm `css_modules::hash` Rust signature (likely `core::fmt::Arguments`).
            format_args!(
                "{}_{}",
                bstr::BStr::new(filename),
                bstr::BStr::new(&rule.url)
            ),
            false,
        );

        ImportDependency {
            // TODO(zack): should we clone this? lightningcss does that
            url: rule.url as *const [u8],
            placeholder: placeholder as *const [u8],
            supports,
            media,
            loc: SourceRange::new(
                filename,
                Location {
                    line: rule.loc.line + 1,
                    column: rule.loc.column,
                },
                8,
                rule.url.len() + 2,
            ), // TODO: what about @import url(...)?
        }
    }
}

/// A `url()` dependency.
pub struct UrlDependency {
    /// The url of the dependency.
    // TODO(port): lifetime — arena-borrowed from `import_records[..].path.pretty`.
    pub url: *const [u8],
    /// The placeholder that the URL was replaced with.
    // TODO(port): lifetime — arena-allocated by `css_modules::hash`.
    pub placeholder: *const [u8],
    /// The location of the dependency in the source file.
    pub loc: SourceRange,
}

impl UrlDependency {
    pub fn new<'bump>(
        bump: &'bump Arena,
        url: &Url,
        filename: &[u8],
        import_records: &BabyList<ImportRecord>,
    ) -> UrlDependency {
        let theurl: &[u8] = &import_records.at(url.import_record_idx).path.pretty;
        let placeholder = css::css_modules::hash(
            bump,
            // TODO(port): see note in ImportDependency::new re: `css_modules::hash` signature.
            format_args!(
                "{}_{}",
                bstr::BStr::new(filename),
                bstr::BStr::new(theurl)
            ),
            false,
        );
        UrlDependency {
            url: theurl as *const [u8],
            placeholder: placeholder as *const [u8],
            loc: SourceRange::new(filename, url.loc, 4, theurl.len()),
        }
    }
}

/// Represents the range of source code where a dependency was found.
pub struct SourceRange {
    /// The filename in which the dependency was found.
    // TODO(port): lifetime — borrowed from caller (printer's filename); arena/static.
    pub file_path: *const [u8],
    /// The starting line and column position of the dependency.
    pub start: Location,
    /// The ending line and column position of the dependency.
    pub end: Location,
}

impl SourceRange {
    pub fn new(filename: &[u8], loc: Location, offset: u32, len: usize) -> SourceRange {
        SourceRange {
            file_path: filename as *const [u8],
            start: Location {
                line: loc.line,
                column: loc.column + offset,
            },
            end: Location {
                line: loc.line,
                column: loc.column + offset + u32::try_from(len).unwrap() - 1,
            },
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/dependencies.zig (151 lines)
//   confidence: medium
//   todos:      9
//   notes:      All `[]const u8` struct fields are arena-borrowed → raw `*const [u8]` per guide; Phase B may unify on `&'bump [u8]`. `css_modules::hash` / `to_css::string` signatures assumed.
// ──────────────────────────────────────────────────────────────────────────
