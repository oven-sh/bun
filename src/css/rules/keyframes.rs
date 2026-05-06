use core::hash::{Hash, Hasher};

use crate as css;
use crate::css_rules::Location;
use crate::css_values::ident::CustomIdent;
use crate::css_values::percentage::Percentage;
use crate::{DeclarationBlock, PrintErr, Printer, VendorPrefix};

// PERF(port): Zig used arena-backed `std.ArrayListUnmanaged` fed by
// `input.allocator()`. Phase B threads `'bump` and switches to
// `bumpalo::collections::Vec<'bump, T>` crate-wide; until then `Vec<T>`.
type ArrayList<T> = Vec<T>;

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
            // SAFETY: CustomIdent.v points into the parser arena which outlives the AST.
            KeyframesName::Ident(ident) => state.write(unsafe { &*ident.v }),
            KeyframesName::Custom(s) => state.write(s),
        }
    }
}

impl PartialEq for KeyframesName {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (KeyframesName::Ident(a), KeyframesName::Ident(b)) => {
                // SAFETY: CustomIdent.v points into the parser arena which outlives the AST.
                bun_string::strings::eql(unsafe { &*a.v }, unsafe { &*b.v })
            }
            (KeyframesName::Custom(a), KeyframesName::Custom(b)) => bun_string::strings::eql(a, b),
            _ => false,
        }
    }
}
impl Eq for KeyframesName {}

// ─── KeyframesName behavior ───────────────────────────────────────────────
// blocked_on: Parser::next/Token shape (css_parser.rs), Printer::write_ident,
// Printer.css_module field, css::serializer::serialize_string, DeepClone.
#[cfg(any())]
impl KeyframesName {
    pub fn parse(input: &mut css::Parser) -> css::Result<KeyframesName> {
        use bun_str::strings;
        let tok = match input.next() {
            Ok(v) => v.clone(),
            Err(e) => return Err(e),
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
                    Err(input.new_unexpected_token_error(css::Token::Ident(s)))
                } else {
                    Ok(KeyframesName::Ident(CustomIdent { v: s }))
                }
            }
            css::Token::QuotedString(s) => Ok(KeyframesName::Custom(s)),
            t => Err(input.new_unexpected_token_error(t)),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        use bun_str::strings;
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

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
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

// ─── KeyframeSelector behavior ────────────────────────────────────────────
// blocked_on: css::derive_parse (DeriveParse comptime macro replacement),
// Percentage::to_css, DeepClone.
#[cfg(any())]
impl KeyframeSelector {
    // TODO: implement this
    // Zig: `pub const parse = css.DeriveParse(@This()).parse;`
    // TODO(port): `DeriveParse` is a comptime type-generator producing `parse` from
    // variant introspection. Replace with `#[derive(css::Parse)]` proc-macro in Phase B.
    pub fn parse(input: &mut css::Parser) -> css::Result<KeyframeSelector> {
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

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
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
pub struct Keyframe {
    /// A list of keyframe selectors to associate with the declarations in this keyframe.
    pub selectors: ArrayList<KeyframeSelector>,
    /// The declarations for this keyframe.
    // PORT NOTE: lifetime erased to `'static` per rules/mod.rs `CssRule<R>` note.
    pub declarations: DeclarationBlock<'static>,
}

// ─── Keyframe behavior ────────────────────────────────────────────────────
// blocked_on: KeyframeSelector::to_css, DeclarationBlock::to_css_block,
// DeepClone.
#[cfg(any())]
impl Keyframe {
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let mut first = true;
        for sel in self.selectors.iter() {
            if !first {
                dest.delim(b',', false)?;
            }
            first = false;
            sel.to_css(dest)?;
        }

        self.declarations.to_css_block(dest)
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone — see note on KeyframesName::deep_clone.
        css::implement_deep_clone(self, bump)
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

// ─── KeyframesRule behavior ───────────────────────────────────────────────
// blocked_on: KeyframesName::to_css, Keyframe::to_css, DeepClone.
#[cfg(any())]
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
                prefix.to_css(dest)?;
                dest.write_str("keyframes ")?;
                self.name.to_css(dest)?;
                dest.whitespace()?;
                dest.write_char(b'{')?;
                dest.indent();

                let mut first = true;
                for keyframe in self.keyframes.iter() {
                    if first {
                        first = false;
                    } else if !dest.minify {
                        dest.write_char(b'\n')?; // no indent
                    }
                    dest.newline()?;
                    keyframe.to_css(dest)?;
                }
                dest.dedent();
                dest.newline()?;
                dest.write_char(b'}')?;
            }
        }
        Ok(())
    }

    pub fn get_fallbacks<T>(&mut self, _targets: &css::targets::Targets) -> &[css::css_rules::CssRule<T>] {
        let _ = self;
        // Zig: `@compileError(css.todo_stuff.depth)` — intentionally unimplemented.
        // TODO(port): implement keyframes fallbacks (was a compile-time stub in Zig).
        unimplemented!("css.todo_stuff.depth")
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone — see note on KeyframesName::deep_clone.
        css::implement_deep_clone(self, bump)
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
// allocator threading.
#[cfg(any())]
const _: () = {
    use css::{BasicParseErrorKind, Maybe, Parser, ParserOptions, ParserState, Result};

    impl css::DeclarationParser for KeyframesListParser {
        type Declaration = Keyframe;

        fn parse_value(&mut self, name: &[u8], input: &mut Parser) -> Result<Self::Declaration> {
            Err(input.new_error(BasicParseErrorKind::UnexpectedToken(css::Token::Ident(name))))
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

    impl css::AtRuleParser for KeyframesListParser {
        type Prelude = ();
        type AtRule = Keyframe;

        fn parse_prelude(&mut self, name: &[u8], input: &mut Parser) -> Result<Self::Prelude> {
            Err(input.new_error(BasicParseErrorKind::AtRuleInvalid(name)))
        }

        fn parse_block(
            &mut self,
            _prelude: Self::Prelude,
            _start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::AtRule> {
            Err(input.new_error(BasicParseErrorKind::AtRuleBodyInvalid))
        }

        fn rule_without_block(
            &mut self,
            _prelude: Self::Prelude,
            _start: &ParserState,
        ) -> Maybe<Self::AtRule, ()> {
            Err(())
        }
    }

    impl css::QualifiedRuleParser for KeyframesListParser {
        type Prelude = ArrayList<KeyframeSelector>;
        type QualifiedRule = Keyframe;

        fn parse_prelude(&mut self, input: &mut Parser) -> Result<Self::Prelude> {
            input.parse_comma_separated(KeyframeSelector::parse)
        }

        fn parse_block(
            &mut self,
            prelude: Self::Prelude,
            _start: &ParserState,
            input: &mut Parser,
        ) -> Result<Self::QualifiedRule> {
            // For now there are no options that apply within @keyframes
            let options = ParserOptions::default(input.allocator(), None);
            let declarations = match DeclarationBlock::parse(input, &options) {
                Ok(vv) => vv,
                Err(e) => return Err(e),
            };
            Ok(Keyframe { selectors: prelude, declarations })
        }
    }
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/keyframes.zig (303 lines)
//   confidence: medium
//   todos:      6
//   notes:      structs/enums un-gated (data-only); ArrayList=Vec + DeclarationBlock<'static> until 'bump threaded; parse/to_css/deep_clone + parser-trait impls gated on css_parser trait surface, Printer.css_module/write_ident, DeriveParse, DeepClone derive
// ──────────────────────────────────────────────────────────────────────────
