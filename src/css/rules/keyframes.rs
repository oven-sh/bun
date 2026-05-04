use core::hash::{Hash, Hasher};

use bumpalo::collections::Vec as BumpVec;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::ArrayHashMap;
use bun_str::strings;

use crate as css;
use crate::css_rules::Location;
use crate::css_values::ident::CustomIdent;
use crate::css_values::percentage::Percentage;
use crate::targets::Targets;
use crate::{
    BasicParseErrorKind, CssRule, DeclarationBlock, Maybe, Parser, ParserOptions, ParserState,
    PrintErr, Printer, Result, VendorPrefix,
};

// ──────────────────────────────────────────────────────────────────────────
// KeyframesListParser
// ──────────────────────────────────────────────────────────────────────────

pub struct KeyframesListParser;

// PORT NOTE: in Zig these are nested `pub const DeclarationParser = struct { ... }`
// namespaces that the css parser duck-types via `@hasDecl`. In Rust they become
// trait impls on `KeyframesListParser`. Exact trait signatures to be reconciled
// in Phase B against `bun_css::{DeclarationParser, AtRuleParser, QualifiedRuleParser,
// RuleBodyItemParser}`.

impl<'bump> css::DeclarationParser<'bump> for KeyframesListParser {
    type Declaration = Keyframe<'bump>;

    fn parse_value(
        &mut self,
        name: &'bump [u8],
        input: &mut Parser<'bump, '_>,
    ) -> Result<Self::Declaration> {
        Result::Err(input.new_error(BasicParseErrorKind::UnexpectedToken(
            css::Token::Ident(name),
        )))
    }
}

impl css::RuleBodyItemParser for KeyframesListParser {
    fn parse_qualified(&self) -> bool {
        true
    }

    fn parse_declarations(&self) -> bool {
        false
    }
}

impl<'bump> css::AtRuleParser<'bump> for KeyframesListParser {
    type Prelude = ();
    type AtRule = Keyframe<'bump>;

    fn parse_prelude(
        &mut self,
        name: &'bump [u8],
        input: &mut Parser<'bump, '_>,
    ) -> Result<Self::Prelude> {
        Result::Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)))
    }

    fn parse_block(
        &mut self,
        _prelude: Self::Prelude,
        _start: &ParserState,
        input: &mut Parser<'bump, '_>,
    ) -> Result<Self::AtRule> {
        Result::Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid))
    }

    fn rule_without_block(
        &mut self,
        _prelude: Self::Prelude,
        _start: &ParserState,
    ) -> Maybe<Self::AtRule, ()> {
        Maybe::Err(())
    }
}

impl<'bump> css::QualifiedRuleParser<'bump> for KeyframesListParser {
    type Prelude = BumpVec<'bump, KeyframeSelector>;
    type QualifiedRule = Keyframe<'bump>;

    fn parse_prelude(&mut self, input: &mut Parser<'bump, '_>) -> Result<Self::Prelude> {
        input.parse_comma_separated(KeyframeSelector::parse)
    }

    fn parse_block(
        &mut self,
        prelude: Self::Prelude,
        _start: &ParserState,
        input: &mut Parser<'bump, '_>,
    ) -> Result<Self::QualifiedRule> {
        // For now there are no options that apply within @keyframes
        let options = ParserOptions::default(input.allocator(), None);
        let declarations = match DeclarationBlock::parse(input, &options) {
            Result::Ok(vv) => vv,
            Result::Err(e) => return Result::Err(e),
        };
        Result::Ok(Keyframe {
            selectors: prelude,
            declarations,
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// KeyframesName
// ──────────────────────────────────────────────────────────────────────────

/// KeyframesName
pub enum KeyframesName<'bump> {
    /// `<custom-ident>` of a `@keyframes` name.
    Ident(CustomIdent<'bump>),
    /// `<string>` of a `@keyframes` name.
    Custom(&'bump [u8]),
}

// Zig: `pub fn HashMap(comptime V: type) type { return std.ArrayHashMapUnmanaged(...) }`
// → a generic type alias keyed by `KeyframesName` with the custom hash/eq below.
pub type KeyframesNameHashMap<'bump, V> = ArrayHashMap<KeyframesName<'bump>, V>;

impl<'bump> Hash for KeyframesName<'bump> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        // Matches Zig: hash only the underlying string bytes; variant tag does NOT
        // participate (Zig's `hash` switches and calls `hashString` on the slice).
        match self {
            KeyframesName::Ident(ident) => state.write(ident.v),
            KeyframesName::Custom(s) => state.write(s),
        }
    }
}

impl<'bump> PartialEq for KeyframesName<'bump> {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (KeyframesName::Ident(a), KeyframesName::Ident(b)) => strings::eql(a.v, b.v),
            (KeyframesName::Custom(a), KeyframesName::Custom(b)) => strings::eql(a, b),
            _ => false,
        }
    }
}
impl<'bump> Eq for KeyframesName<'bump> {}

impl<'bump> KeyframesName<'bump> {
    pub fn parse(input: &mut Parser<'bump, '_>) -> Result<KeyframesName<'bump>> {
        let tok = match input.next() {
            Result::Ok(v) => *v,
            Result::Err(e) => return Result::Err(e),
        };
        match tok {
            css::Token::Ident(s) => {
                // todo_stuff.match_ignore_ascii_case
                // CSS-wide keywords without quotes throws an error.
                if strings::eql_case_insensitive_ascii_check_length(s, b"none")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"initial")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"inherit")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"unset")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"default")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"revert")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"revert-layer")
                {
                    Result::Err(input.new_unexpected_token_error(css::Token::Ident(s)))
                } else {
                    Result::Ok(KeyframesName::Ident(CustomIdent { v: s }))
                }
            }
            css::Token::QuotedString(s) => Result::Ok(KeyframesName::Custom(s)),
            t => Result::Err(input.new_unexpected_token_error(t)),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let css_module_aimation_enabled = if let Some(css_module) = &dest.css_module {
            css_module.config.animation
        } else {
            false
        };

        match self {
            KeyframesName::Ident(ident) => {
                dest.write_ident(ident.v, css_module_aimation_enabled)?;
            }
            KeyframesName::Custom(s) => {
                // todo_stuff.match_ignore_ascii_case
                // CSS-wide keywords and `none` cannot remove quotes.
                if strings::eql_case_insensitive_ascii_check_length(s, b"none")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"initial")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"inherit")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"unset")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"default")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"revert")
                    || strings::eql_case_insensitive_ascii_check_length(s, b"revert-layer")
                {
                    if css::serializer::serialize_string(s, dest).is_err() {
                        return dest.add_fmt_error();
                    }
                } else {
                    dest.write_ident(s, css_module_aimation_enabled)?;
                }
            }
        }
        Ok(())
    }

    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime field-reflection; replace with
        // a `#[derive(DeepClone)]` or hand-rolled clone in Phase B.
        css::implement_deep_clone(self, bump)
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
    // TODO: implement this
    // Zig: `pub const parse = css.DeriveParse(@This()).parse;`
    // TODO(port): `DeriveParse` is a comptime type-generator producing `parse` from
    // variant introspection. Replace with `#[derive(css::Parse)]` proc-macro in Phase B.
    pub fn parse<'bump>(input: &mut Parser<'bump, '_>) -> Result<KeyframeSelector> {
        css::derive_parse::<KeyframeSelector>(input)
    }

    // pub fn parse(input: *css.Parser) Result(KeyframeSelector) {
    //     _ = input; // autofix
    //     @panic(css.todo_stuff.depth);
    // }

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

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        // TODO(port): css.implementDeepClone — see note on KeyframesName::deep_clone.
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Keyframe
// ──────────────────────────────────────────────────────────────────────────

/// An individual keyframe within an `@keyframes` rule.
///
/// See [KeyframesRule](KeyframesRule).
pub struct Keyframe<'bump> {
    /// A list of keyframe selectors to associate with the declarations in this keyframe.
    pub selectors: BumpVec<'bump, KeyframeSelector>,
    /// The declarations for this keyframe.
    pub declarations: DeclarationBlock<'bump>,
}

impl<'bump> Keyframe<'bump> {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let mut first = true;
        for sel in self.selectors.iter() {
            if !first {
                dest.delim(',', false)?;
            }
            first = false;
            sel.to_css(dest)?;
        }

        self.declarations.to_css_block(dest)
    }

    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // TODO(port): css.implementDeepClone — see note on KeyframesName::deep_clone.
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// KeyframesRule
// ──────────────────────────────────────────────────────────────────────────

pub struct KeyframesRule<'bump> {
    /// The animation name.
    /// <keyframes-name> = <custom-ident> | <string>
    pub name: KeyframesName<'bump>,
    /// A list of keyframes in the animation.
    pub keyframes: BumpVec<'bump, Keyframe<'bump>>,
    /// A vendor prefix for the rule, e.g. `@-webkit-keyframes`.
    pub vendor_prefix: VendorPrefix,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<'bump> KeyframesRule<'bump> {
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
                        dest.write_char('\n')?; // no indent
                    }
                    dest.newline()?;
                }

                dest.write_char('@')?;
                prefix.to_css(dest)?;
                dest.write_str("keyframes ")?;
                self.name.to_css(dest)?;
                dest.whitespace()?;
                dest.write_char('{')?;
                dest.indent();

                let mut first = true;
                for keyframe in self.keyframes.iter() {
                    if first {
                        first = false;
                    } else if !dest.minify {
                        dest.write_char('\n')?; // no indent
                    }
                    dest.newline()?;
                    keyframe.to_css(dest)?;
                }
                dest.dedent();
                dest.newline()?;
                dest.write_char('}')?;
            }
        }
        Ok(())
    }

    pub fn get_fallbacks<T>(&mut self, _targets: &Targets) -> &[CssRule<T>] {
        let _ = self;
        // Zig: `@compileError(css.todo_stuff.depth)` — intentionally unimplemented.
        // TODO(port): implement keyframes fallbacks (was a compile-time stub in Zig).
        unimplemented!("css.todo_stuff.depth")
    }

    pub fn deep_clone(&self, bump: &'bump Arena) -> Self {
        // TODO(port): css.implementDeepClone — see note on KeyframesName::deep_clone.
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/keyframes.zig (303 lines)
//   confidence: medium
//   todos:      6
//   notes:      CSS is an AST crate → added <'bump> lifetimes per §Allocators; parser-trait impl signatures and DeriveParse/implementDeepClone need Phase B reconciliation.
// ──────────────────────────────────────────────────────────────────────────
