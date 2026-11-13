use crate::SmallList;
use crate::css_parser as css;
use crate::css_parser::{CssResult, Parser, PrintErr, Printer, Token};

use bun_ast::Ref;
use bun_core::strings;
use bun_wyhash::Wyhash;

// ──────────────────────── arena-slice newtype boilerplate ────────────────
// `DashedIdent` / `Ident` / `CustomIdent` are DISTINCT CSS value types per
// spec (their `parse`/`to_css` differ intentionally — `--` prefix check,
// plain ident, CSS-wide-keyword rejection respectively) but share an
// identical newtype shell. This macro stamps out the struct + `deep_clone`/`hash`
// boilerplate; per-type `parse`/`to_css` live in separate inherent `impl`
// blocks below (Rust allows multiple inherent impls).
macro_rules! arena_slice_newtype {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, crate::CssEql)]
        pub struct $name<'bump> {
            pub v: &'bump [u8],
        }

        impl $name<'_> {
            pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
                *self
            }

            pub fn hash(&self, hasher: &mut Wyhash) {
                // Hash the arena slice bytes.
                hasher.update(self.v);
            }
        }
    };
}

// ───────────────────────── DashedIdentReference ──────────────────────────
// `properties::css_modules::Specifier` is real (parse/to_css/eql/hash); the
// `from` field below uses it directly. `parse_with_options` honors
// `ParserOptions.css_modules.dashed_idents`. `to_css` resolves the
// import-record path up front and hands it to `CssModule::reference_dashed`.

/// A CSS [`<dashed-ident>`](https://www.w3.org/TR/css-values-4/#dashed-idents) reference.
///
/// Dashed idents are used in cases where an identifier can be either author defined _or_ CSS-defined.
/// Author defined idents must start with two dash characters ("--") or parsing will fail.
///
/// In CSS modules, when the `dashed_idents` option is enabled, the identifier may be followed by the
/// `from` keyword and an argument indicating where the referenced identifier is declared (e.g. a filename).
#[derive(Debug, Clone, Copy)]
pub struct DashedIdentReference<'bump> {
    /// The referenced identifier.
    pub(crate) ident: DashedIdent<'bump>,
    /// CSS modules extension: the filename where the variable is defined.
    /// Only enabled when the CSS modules `dashed_idents` option is turned on.
    pub(crate) from: Option<crate::properties::css_modules::Specifier>,
}

impl<'bump> DashedIdentReference<'bump> {
    pub(crate) fn eql(&self, rhs: &Self) -> bool {
        // Field-wise over `ident` and `from`.
        use crate::generics::CssEql;
        self.ident.eql(&rhs.ident) && self.from.eql(&rhs.from)
    }

    pub(crate) fn hash(&self, hasher: &mut Wyhash) {
        self.ident.hash(hasher);
        if let Some(from) = &self.from {
            from.hash(hasher);
        }
    }

    pub(crate) fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        *self
    }

    pub(crate) fn parse_with_options(
        input: &mut Parser<'_, 'bump>,
        options: &css::ParserOptions,
    ) -> CssResult<'bump, DashedIdentReference<'bump>> {
        let ident = DashedIdent::parse(input)?;
        let from = if options
            .css_modules
            .as_ref()
            .is_some_and(|m| m.dashed_idents)
        {
            if input
                .try_parse(|i| i.expect_ident_matching(b"from"))
                .is_ok()
            {
                Some(crate::properties::css_modules::Specifier::parse(input)?)
            } else {
                None
            }
        } else {
            None
        };
        Ok(DashedIdentReference { ident, from })
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let dashed_idents = match &dest.css_module {
            Some(m) => m.config.dashed_idents,
            None => false,
        };
        if dashed_idents {
            let source_index = dest.loc.source_index;
            let bump = dest.arena;
            // Borrowck forbids handing
            // `dest` to a method on `dest.css_module`, so resolve the path
            // here and pass the slice down. The `?` propagates the
            // `import_record` error path.
            use crate::properties::css_modules::Specifier;
            let specifier_path: Option<&[u8]> = match &self.from {
                Some(Specifier::ImportRecordIndex(idx)) => {
                    Some(dest.import_record(*idx)?.path.text)
                }
                _ => None,
            };
            let name = dest.css_module.as_ref().unwrap().reference_dashed(
                bump,
                self.ident.v,
                self.from,
                specifier_path,
                source_index,
            );
            if let Some(name) = name {
                dest.write_str(b"--")?;
                return dest.serialize_name(name);
            }
        }
        dest.write_dashed_ident(&self.ident)
    }
}

pub use DashedIdent as DashedIdentFns;

arena_slice_newtype! {
    /// A CSS [`<dashed-ident>`](https://www.w3.org/TR/css-values-4/#dashed-idents) declaration.
    ///
    /// Dashed idents are used in cases where an identifier can be either author defined _or_ CSS-defined.
    /// Author defined idents must start with two dash characters ("--") or parsing will fail.
    DashedIdent
}

impl<'bump> DashedIdent<'bump> {
    pub(crate) fn new(v: &'bump [u8]) -> Option<Self> {
        v.starts_with(b"--").then_some(Self { v })
    }

    pub fn parse(input: &mut Parser<'_, 'bump>) -> CssResult<'bump, DashedIdent<'bump>> {
        let location = input.current_source_location();
        let ident = input.expect_ident()?;
        Self::new(ident).ok_or_else(|| location.new_unexpected_token_error(Token::Ident(ident)))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_dashed_ident(self)
    }
}

pub use Ident as IdentFns;

arena_slice_newtype! {
    /// A CSS [`<ident>`](https://www.w3.org/TR/css-values-4/#css-css-identifier).
    Ident
}

impl<'bump> Ident<'bump> {
    pub fn parse(input: &mut Parser<'_, 'bump>) -> CssResult<'bump, Ident<'bump>> {
        let ident = input.expect_ident()?;
        Ok(Ident { v: ident })
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.serialize_identifier(self.v)
    }
}

// ───────────────────────────── IdentOrRef ────────────────────────────────

/// An `Ident`, or the bundler's `Ref` to a local name of a CSS module.
#[derive(Clone, Copy)]
pub enum IdentOrRef<'bump> {
    Ident(Ident<'bump>),
    Ref(Ref),
}

const _: () = assert!(size_of::<IdentOrRef<'static>>() == 16);

impl<'bump> IdentOrRef<'bump> {
    #[inline]
    pub(crate) fn as_ref(self) -> Option<Ref> {
        match self {
            Self::Ident(_) => None,
            Self::Ref(r) => Some(r),
        }
    }

    pub(crate) fn as_original_string(self, symbols: &'bump [bun_ast::Symbol]) -> &'bump [u8] {
        match self {
            Self::Ident(ident) => ident.v,
            Self::Ref(r) => symbols[r.inner_index() as usize].original_name.slice(),
        }
    }

    pub(crate) fn hash(&self, hasher: &mut Wyhash) {
        match self {
            Self::Ident(ident) => hasher.update(ident.v),
            Self::Ref(r) => hasher.update(&r.to_raw_bits().to_ne_bytes()),
        }
    }

    pub fn eql(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Ident(a), Self::Ident(b)) => a.v == b.v,
            (Self::Ref(a), Self::Ref(b)) => a.eql(*b),
            _ => false,
        }
    }
}

impl core::fmt::Display for IdentOrRef<'_> {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Ident(ident) => write!(writer, "Ident({})", bstr::BStr::new(ident.v)),
            Self::Ref(r) => write!(writer, "Ref({:?})", r),
        }
    }
}

pub use CustomIdent as CustomIdentFns;

/// ASCII-case-insensitive check for the words reserved from the
/// [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents)
/// production: the CSS-wide keywords + `default`.
///
/// `default` is *not* a CSS-wide keyword (cf. [`CSSWideKeyword`]); it is
/// reserved separately by css-values-4. `none` is *not* in this set —
/// `<keyframes-name>` / `<single-animation-name>` callers check it themselves.
#[inline]
pub(crate) fn is_reserved_custom_ident(s: &[u8]) -> bool {
    strings::eql_any_case_insensitive_ascii(
        s,
        &[
            b"initial",
            b"inherit",
            b"unset",
            b"default",
            b"revert",
            b"revert-layer",
            b"revert-rule",
        ],
    )
}

arena_slice_newtype! {
    /// A CSS [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents).
    CustomIdent
}

impl<'bump> CustomIdent<'bump> {
    pub(crate) fn new(v: &'bump [u8]) -> Option<Self> {
        (!is_reserved_custom_ident(v)).then_some(Self { v })
    }

    pub fn parse(input: &mut Parser<'_, 'bump>) -> CssResult<'bump, CustomIdent<'bump>> {
        let location = input.current_source_location();
        let ident = input.expect_ident()?;
        Self::new(ident).ok_or_else(|| location.new_unexpected_token_error(Token::Ident(ident)))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        Self::to_css_with_options(self, dest, true)
    }

    /// Write the custom ident to CSS.
    pub(crate) fn to_css_with_options(
        &self,
        dest: &mut Printer,
        enabled_css_modules: bool,
    ) -> Result<(), PrintErr> {
        let css_module_custom_idents_enabled = enabled_css_modules
            && if let Some(css_module) = &dest.css_module {
                css_module.config.custom_idents
            } else {
                false
            };
        dest.write_ident(self.v, css_module_custom_idents_enabled)
    }
}

/// A list of CSS [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents) values.
pub type CustomIdentList<'bump> = SmallList<CustomIdent<'bump>, 1>;

/// `none | <custom-ident>+`: the `none` keyword, or a space-separated list of
/// [`<custom-ident>`](https://www.w3.org/TR/css-values-4/#custom-idents) values.
#[derive(Clone, crate::CssEql, crate::DeepClone)]
pub enum NoneOrCustomIdentList<'bump> {
    /// The `none` keyword.
    None,
    /// A list of idents.
    Idents(CustomIdentList<'bump>),
}

impl<'bump> NoneOrCustomIdentList<'bump> {
    pub fn parse(input: &mut Parser<'_, 'bump>) -> CssResult<'bump, Self> {
        let mut idents = CustomIdentList::default();
        while let Ok(ident) = input.try_parse(CustomIdent::parse) {
            if strings::eql_case_insensitive_ascii_check_length(ident.v, b"none") {
                if idents.len() == 0 {
                    return Ok(Self::None);
                }
                return Err(input.new_custom_error(css::ParserError::invalid_value));
            }
            idents.append(ident);
        }
        if idents.len() == 0 {
            return Err(input.new_error_for_next_token());
        }
        Ok(Self::Idents(idents))
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Self::None => dest.write_str(b"none"),
            Self::Idents(idents) => dest.write_separated(
                idents.slice(),
                |d| d.write_char(b' '),
                |d, ident| ident.to_css(d),
            ),
        }
    }
}
