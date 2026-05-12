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
// PORT NOTE: Zig threaded the parser-input lifetime; Phase A keeps
// `&'static [u8]` per PORTING.md §AST crates and the rules/mod.rs
// `CssRule<R>` lifetime-erasure note. Phase B re-threads `'bump`.
pub enum KeyframesName {
    /// `<custom-ident>` of a `@keyframes` name.
    Ident(CustomIdent),
    /// `<string>` of a `@keyframes` name.
    Custom(&'static [u8]),
}

// Zig: `pub fn HashMap(comptime V: type) type { return std.ArrayHashMapUnmanaged(...) }`
// → a generic type alias keyed by `KeyframesName` with the custom hash/eq below.
pub type KeyframesNameHashMap<V> = bun_collections::ArrayHashMap<KeyframesName, V>;

impl Hash for KeyframesName {
    fn hash<H: Hasher>(&self, state: &mut H) {
        // Matches Zig: hash only the underlying string bytes; variant tag does NOT
        // participate (Zig's `hash` switches and calls `hashString` on the slice).
        match self {
            KeyframesName::Ident(ident) => state.write(ident.v()),
            KeyframesName::Custom(s) => state.write(s),
        }
    }
}

impl PartialEq for KeyframesName {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (KeyframesName::Ident(a), KeyframesName::Ident(b)) => bun_core::eql(a.v(), b.v()),
            (KeyframesName::Custom(a), KeyframesName::Custom(b)) => bun_core::eql(a, b),
            _ => false,
        }
    }
}
impl Eq for KeyframesName {}

impl KeyframesName {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
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
                // SAFETY: CustomIdent.v points into the parser arena which outlives the AST.
                write_ident(
                    dest,
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
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` variant-walk. `Custom(&'static [u8])`
        // is an arena-owned slice → identity copy (generics.zig "const strings").
        match self {
            Self::Ident(i) => Self::Ident(i.deep_clone(bump)),
            Self::Custom(s) => Self::Custom(s),
        }
    }
}

// ─── KeyframesName parse ──────────────────────────────────────────────────
impl KeyframesName {
    pub fn parse(input: &mut css::Parser) -> css::Result<KeyframesName> {
        use bun_core::strings;
        let tok = match input.next() {
            Ok(v) => v.clone(),
            Err(e) => return Err(e),
        };
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
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
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
    pub fn deep_clone(&self, _bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` variant-walk. `Percentage` is
        // `Copy` (`{ v: f32 }`) → identity.
        match self {
            Self::Percentage(p) => Self::Percentage(*p),
            Self::From => Self::From,
            Self::To => Self::To,
        }
    }
}

// ─── KeyframeSelector parse ───────────────────────────────────────────────
// blocked_on: css::derive_parse (DeriveParse comptime macro replacement).

impl KeyframeSelector {
    // Zig: `pub const parse = css.DeriveParse(@This()).parse;`
    // PORT NOTE: `DeriveParse` is a comptime type-generator producing `parse` from
    // variant introspection. Expanded by hand here: try the tuple variant
    // (`Percentage`) first, then fall back to keyword idents (`from`/`to`).
    pub fn parse(input: &mut css::Parser) -> css::Result<KeyframeSelector> {
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
    pub selectors: ArrayList<KeyframeSelector>,
    /// The declarations for this keyframe.
    // PORT NOTE: lifetime erased to `'static` per rules/mod.rs `CssRule<R>` note.
    pub declarations: DeclarationBlock<'static>,
}

impl Keyframe {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.write_comma_separated(self.selectors.iter(), |d, sel| sel.to_css(d))?;
        super::decl_block_to_css(&self.declarations, dest)
    }
}

impl Keyframe {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk.
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
    pub name: KeyframesName,
    /// A list of keyframes in the animation.
    pub keyframes: ArrayList<Keyframe>,
    /// A vendor prefix for the rule, e.g. `@-webkit-keyframes`.
    pub vendor_prefix: VendorPrefix,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl KeyframesRule {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        let mut first_rule = true;

        // Zig: `inline for (.{ "webkit", "moz", "ms", "o", "none" }) |prefix_name|` with
        // `@field(this.vendor_prefix, prefix_name)`. VendorPrefix is a packed-bool struct
        // (→ `bitflags!`), so iterate the flag constants directly and use `.contains()`.
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
    pub fn get_fallbacks<T>(
        &mut self,
        _targets: &css::targets::Targets,
    ) -> &[css::css_rules::CssRule<T>] {
        // PORT NOTE: Zig spec body is `@compileError(css.todo_stuff.depth)` — the fn is
        // declared but never instantiated; its sole call site in `rules.zig`
        // (`CssRuleList.minify` → `.keyframes` arm) is commented out and replaced with
        // `debug("TODO: KeyframesRule", ...)`. lightningcss upstream computes per-keyframe
        // *declaration* fallbacks inline in the minify loop rather than emitting whole
        // `CssRule` fallbacks here, so there is no rule-level fallback list to return.
        // The faithful port of "compile-time-dead, returns []CssRule(T)" is the empty
        // slice — matches the Zig program's observable behavior (no fallbacks appended)
        // without a runtime trap. Phase B wires the declaration-level path in
        // `CssRuleList::minify` directly and may delete this stub.
        let _ = self;
        &[]
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `VendorPrefix` is a
        // `Copy` bitflag (generics.zig "simple copy types" → identity).
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

pub struct KeyframesListParser;

// PORT NOTE: in Zig these are nested `pub const DeclarationParser = struct { ... }`
// namespaces that the css parser duck-types via `@hasDecl`. In Rust they become
// trait impls on `KeyframesListParser`.
//
// blocked_on: css::{DeclarationParser, AtRuleParser, QualifiedRuleParser,
// RuleBodyItemParser} trait signatures (css_parser.rs round-5 surface),
// Parser::parse_comma_separated, DeclarationBlock::parse, ParserOptions::default
// arena threading.

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
            let declarations = match DeclarationBlock::parse(input, &options) {
                Ok(vv) => vv,
                Err(e) => return Err(e),
            };
            Ok(Keyframe {
                selectors: prelude,
                declarations,
            })
        }
    }
};

// ported from: src/css/rules/keyframes.zig
