use core::hash::{Hash, Hasher};

use crate as css;
use crate::css_rules::Location;
use crate::css_values::ident::{CustomIdent, is_reserved_custom_ident};
use crate::css_values::percentage::Percentage;
use crate::{DeclarationBlock, PrintErr, Printer, VendorPrefix};

use super::ArrayList;

// ──────────────────────────────────────────────────────────────────────────
// KeyframesName
// ──────────────────────────────────────────────────────────────────────────

/// `<keyframes-name> = <custom-ident> | <string>`
// Stores `&'static [u8]` per the rules/mod.rs `CssRule<R>` lifetime-erasure
// note (mod.rs:37-41).
// TODO(refactor): re-thread `'bump` here.
pub enum KeyframesName {
    /// `<custom-ident>` of a `@keyframes` name.
    Ident(CustomIdent),
    /// `<string>` of a `@keyframes` name.
    Custom(&'static [u8]),
}

// A generic type alias keyed by `KeyframesName` with the custom hash/eq below.

impl Hash for KeyframesName {
    fn hash<H: Hasher>(&self, state: &mut H) {
        // Hash only the underlying string bytes; the variant tag does NOT participate.
        match self {
            KeyframesName::Ident(ident) => state.write(ident.v()),
            KeyframesName::Custom(s) => state.write(s),
        }
    }
}

impl PartialEq for KeyframesName {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (KeyframesName::Ident(a), KeyframesName::Ident(b)) => {
                bun_core::strings::eql(a.v(), b.v())
            }
            (KeyframesName::Custom(a), KeyframesName::Custom(b)) => bun_core::strings::eql(a, b),
            _ => false,
        }
    }
}
impl Eq for KeyframesName {}

impl KeyframesName {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        use bun_core::strings;
        #[inline]
        fn write_ident<'a>(
            dest: &mut Printer<'a>,
            v: &'a [u8],
            handle_css_module: bool,
        ) -> core::result::Result<(), PrintErr> {
            dest.write_ident(v, handle_css_module)
        }

        let css_module_animation_enabled = if let Some(css_module) = &dest.css_module {
            css_module.config.animation
        } else {
            false
        };

        match self {
            KeyframesName::Ident(ident) => {
                write_ident(
                    dest,
                    // SAFETY: CustomIdent.v points into the parser arena which outlives the AST.
                    unsafe { crate::arena_str(ident.v) },
                    css_module_animation_enabled,
                )?;
            }
            KeyframesName::Custom(s) => {
                // CSS-wide keywords and `none` cannot remove quotes.
                if strings::eql_case_insensitive_ascii_check_length(s, b"none")
                    || is_reserved_custom_ident(s)
                {
                    dest.serialize_string(s)?;
                } else {
                    write_ident(dest, s, css_module_animation_enabled)?;
                }
            }
        }
        Ok(())
    }
}

impl KeyframesName {
    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // `Custom(&'static [u8])` is an arena-owned slice → identity copy.
        match self {
            Self::Ident(i) => Self::Ident(i.deep_clone(bump)),
            Self::Custom(s) => Self::Custom(s),
        }
    }
}

// ─── KeyframesName parse ──────────────────────────────────────────────────
impl KeyframesName {
    pub(crate) fn parse(input: &mut css::Parser) -> css::Result<KeyframesName> {
        use bun_core::strings;
        let tok = input.next()?.clone();
        match tok {
            css::Token::Ident(s) => {
                // CSS-wide keywords without quotes throws an error.
                if strings::eql_case_insensitive_ascii_check_length(s, b"none")
                    || is_reserved_custom_ident(s)
                {
                    Err(input.new_unexpected_token_error(css::Token::Ident(s)))
                } else {
                    Ok(KeyframesName::Ident(CustomIdent {
                        v: std::ptr::from_ref::<[u8]>(s),
                    }))
                }
            }
            css::Token::QuotedString(s) => Ok(KeyframesName::Custom(s)),
            t => Err(input.new_unexpected_token_error(t)),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// KeyframeSelector
// ──────────────────────────────────────────────────────────────────────────

pub enum KeyframeSelector {
    /// An explicit percentage.
    Percentage(Percentage),
    /// The `from` keyword. Equivalent to 0%.
    From,
    /// The `to` keyword. Equivalent to 100%.
    To,
}

impl KeyframeSelector {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            KeyframeSelector::Percentage(p) => {
                if dest.minify && p.v == 1.0 {
                    dest.write_str("to")?;
                } else {
                    p.to_css(dest)?;
                }
            }
            KeyframeSelector::From => {
                if dest.minify {
                    dest.write_str("0%")?;
                } else {
                    dest.write_str("from")?;
                }
            }
            KeyframeSelector::To => {
                dest.write_str("to")?;
            }
        }
        Ok(())
    }
}

impl KeyframeSelector {
    fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        match self {
            Self::Percentage(p) => Self::Percentage(*p),
            Self::From => Self::From,
            Self::To => Self::To,
        }
    }
}

// ─── KeyframeSelector parse ───────────────────────────────────────────────

impl KeyframeSelector {
    // Try the tuple variant (`Percentage`) first, then fall back to keyword
    // idents (`from`/`to`).
    fn parse(input: &mut css::Parser) -> css::Result<KeyframeSelector> {
        if let Ok(p) = input.try_parse(Percentage::parse) {
            return Ok(KeyframeSelector::Percentage(p));
        }
        let location = input.current_source_location();
        let ident = input.expect_ident_cloned()?;
        if bun_core::eql_case_insensitive_ascii_check_length(ident, b"from") {
            Ok(KeyframeSelector::From)
        } else if bun_core::eql_case_insensitive_ascii_check_length(ident, b"to") {
            Ok(KeyframeSelector::To)
        } else {
            Err(location.new_unexpected_token_error(css::Token::Ident(ident)))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Keyframe
// ──────────────────────────────────────────────────────────────────────────

/// An individual keyframe within an `@keyframes` rule.
///
/// See [KeyframesRule](KeyframesRule).
pub struct Keyframe {
    /// A list of keyframe selectors to associate with the declarations in this keyframe.
    pub(crate) selectors: ArrayList<KeyframeSelector>,
    /// The declarations for this keyframe.
    // Lifetime erased to `'static` per rules/mod.rs `CssRule<R>` note.
    pub(crate) declarations: DeclarationBlock<'static>,
}

impl Keyframe {
    fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.write_comma_separated(self.selectors.iter(), |d, sel| sel.to_css(d))?;
        super::decl_block_to_css(&self.declarations, dest)
    }
}

impl Keyframe {
    fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            selectors: self.selectors.iter().map(|s| s.deep_clone(bump)).collect(),
            declarations: super::dc::decl_block_static(&self.declarations, bump),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// KeyframesRule
// ──────────────────────────────────────────────────────────────────────────

pub struct KeyframesRule {
    /// The animation name.
    /// <keyframes-name> = <custom-ident> | <string>
    pub(crate) name: KeyframesName,
    /// A list of keyframes in the animation.
    pub(crate) keyframes: ArrayList<Keyframe>,
    /// A vendor prefix for the rule, e.g. `@-webkit-keyframes`.
    pub(crate) vendor_prefix: VendorPrefix,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl KeyframesRule {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        let mut first_rule = true;

        // VendorPrefix is `bitflags!`, so iterate the flag constants directly
        // and use `.contains()`.
        const PREFIXES: [VendorPrefix; 5] = [
            VendorPrefix::WEBKIT,
            VendorPrefix::MOZ,
            VendorPrefix::MS,
            VendorPrefix::O,
            VendorPrefix::NONE,
        ];

        for prefix in PREFIXES {
            if self.vendor_prefix.contains(prefix) {
                if first_rule {
                    first_rule = false;
                } else {
                    if !dest.minify {
                        dest.write_char(b'\n')?; // no indent
                    }
                    dest.newline()?;
                }

                dest.write_char(b'@')?;
                super::vendor_prefix_to_css(prefix, dest)?;
                dest.write_str("keyframes ")?;
                self.name.to_css(dest)?;
                dest.whitespace()?;
                dest.write_char(b'{')?;
                dest.indent();

                dest.write_separated(
                    self.keyframes.iter(),
                    |d| {
                        if d.minify {
                            Ok(())
                        } else {
                            d.write_char(b'\n')
                        }
                    }, // no indent
                    |d, kf| {
                        d.newline()?;
                        kf.to_css(d)
                    },
                )?;
                dest.dedent();
                dest.newline()?;
                dest.write_char(b'}')?;
            }
        }
        Ok(())
    }
}

impl KeyframesRule {
    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            name: self.name.deep_clone(bump),
            keyframes: self.keyframes.iter().map(|k| k.deep_clone(bump)).collect(),
            vendor_prefix: self.vendor_prefix,
            loc: self.loc,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// KeyframesListParser
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct KeyframesListParser;

const _: () = {
    use css::css_parser::{
        AtRuleParser, DeclarationParser, QualifiedRuleParser, RuleBodyItemParser,
    };
    use css::{BasicParseErrorKind, Maybe, Parser, ParserOptions, ParserState, Result};

    impl DeclarationParser for KeyframesListParser {
        type Declaration = Keyframe;

        fn parse_value(
            _this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Declaration> {
            // SAFETY: `name` is a sub-slice of the parser input arena; see `src_str`.
            Err(
                input.new_error(BasicParseErrorKind::unexpected_token(css::Token::Ident(
                    unsafe { css::css_parser::src_str(name) },
                ))),
            )
        }
    }

    impl RuleBodyItemParser for KeyframesListParser {
        fn parse_qualified(_this: &Self) -> bool {
            true
        }

        fn parse_declarations(_this: &Self) -> bool {
            false
        }
    }

    impl AtRuleParser for KeyframesListParser {
        type Prelude = ();
        type AtRule = Keyframe;

        fn parse_prelude(
            _this: &mut Self,
            name: &[u8],
            input: &mut Parser,
        ) -> Result<Self::Prelude> {
            Err(
                input.new_error(BasicParseErrorKind::at_rule_invalid(std::ptr::from_ref::<
                    [u8],
                >(name))),
            )
        }

        fn parse_block(
            _this: &mut Self,
            _prelude: Self::Prelude,
            _start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::AtRule> {
            Err(input.new_error(BasicParseErrorKind::at_rule_body_invalid))
        }

        fn rule_without_block(
            _this: &mut Self,
            _prelude: Self::Prelude,
            _start: &ParserState,
        ) -> Maybe<Self::AtRule, ()> {
            Err(())
        }
    }

    impl QualifiedRuleParser for KeyframesListParser {
        type Prelude = ArrayList<KeyframeSelector>;
        type QualifiedRule = Keyframe;

        fn parse_prelude(_this: &mut Self, input: &mut Parser) -> Result<Self::Prelude> {
            input.parse_comma_separated(KeyframeSelector::parse)
        }

        fn parse_block(
            _this: &mut Self,
            prelude: Self::Prelude,
            _start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::QualifiedRule> {
            // For now there are no options that apply within @keyframes
            let options = ParserOptions::default(None);
            let declarations = DeclarationBlock::parse(input, &options)?;
            Ok(Keyframe {
                selectors: prelude,
                declarations,
            })
        }
    }
};
