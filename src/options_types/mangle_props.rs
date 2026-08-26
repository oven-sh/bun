//! Configuration for `--mangle-props` (property name mangling, as in esbuild).
//! The parser asks [`PropertyMangler::should_mangle`] about every property name
//! it sees; see `bun_js_parser::mangle_props` for what happens to matches.

use bun_install_types::regex::RegularExpression;

/// The `source` and `flags` of a JavaScript `RegExp` (the CLI passes the bare
/// pattern with no flags).
#[derive(Clone, Copy)]
pub struct RegExpSource<'a> {
    pub source: &'a [u8],
    pub flags: &'a [u8],
}

struct Pattern {
    source: Box<[u8]>,
    flags: Box<[u8]>,
    regex: RegularExpression,
}

impl Pattern {
    fn compile(pattern: RegExpSource<'_>) -> Option<Self> {
        Some(Self {
            regex: RegularExpression::compile(pattern.source, pattern.flags)?,
            source: pattern.source.into(),
            flags: pattern.flags.into(),
        })
    }

    /// A compiled regex cannot be shared between threads, so a clone compiles
    /// the pattern again.
    fn recompile(&self) -> Self {
        Self::compile(RegExpSource {
            source: &self.source,
            flags: &self.flags,
        })
        .expect("the pattern compiled when the PropertyMangler was created")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidPattern {
    MangleProps,
    ReserveProps,
}

pub struct PropertyMangler {
    mangle: Pattern,
    reserve: Option<Pattern>,
    /// Also mangle names that appear as string literals in property positions:
    /// `obj["foo_"]`, `{ "foo_": 1 }`, `"foo_" in obj`. Off by default because
    /// quoting a property is the conventional way to say "this name is used by
    /// code outside the bundle".
    pub mangle_quoted: bool,
}

impl PropertyMangler {
    pub fn init(
        mangle: RegExpSource<'_>,
        reserve: Option<RegExpSource<'_>>,
        mangle_quoted: bool,
    ) -> Result<Self, InvalidPattern> {
        let mangle = Pattern::compile(mangle).ok_or(InvalidPattern::MangleProps)?;
        let reserve = match reserve {
            Some(reserve) => Some(Pattern::compile(reserve).ok_or(InvalidPattern::ReserveProps)?),
            None => None,
        };
        Ok(Self {
            mangle,
            reserve,
            mangle_quoted,
        })
    }

    /// Whether a property called `name` should be renamed. `__proto__`,
    /// `constructor` and `prototype` have meaning to the language itself and are
    /// never renamed, whatever the patterns say.
    pub fn should_mangle(&self, name: &[u8]) -> bool {
        !matches!(name, b"__proto__" | b"constructor" | b"prototype")
            && self.mangle.regex.matches(name)
            && !self
                .reserve
                .as_ref()
                .is_some_and(|reserve| reserve.regex.matches(name))
    }
}

impl Clone for PropertyMangler {
    fn clone(&self) -> Self {
        Self {
            mangle: self.mangle.recompile(),
            reserve: self.reserve.as_ref().map(Pattern::recompile),
            mangle_quoted: self.mangle_quoted,
        }
    }
}
