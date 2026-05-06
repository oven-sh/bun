use crate::css_rules::Location;
use crate::properties::custom::TokenList;
use crate::{PrintErr, Printer};

/// An unknown at-rule, stored as raw tokens.
pub struct UnknownAtRule {
    /// The name of the at-rule (without the @).
    // TODO(port): arena lifetime — Zig `[]const u8` backed by parser arena.
    pub name: &'static [u8],
    /// The prelude of the rule.
    pub prelude: TokenList,
    /// The contents of the block, if any.
    pub block: Option<TokenList>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl UnknownAtRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_char(b'@')?;
        dest.write_str(self.name)?;

        if !self.prelude.v.is_empty() {
            dest.write_char(b' ')?;
            self.prelude.to_css(dest, false)?;
        }

        if let Some(block) = &self.block {
            dest.whitespace()?;
            dest.write_char(b'{')?;
            dest.indent();
            dest.newline()?;
            block.to_css(dest, false)?;
            dest.dedent();
            dest.newline()?;
            dest.write_char(b'}')
        } else {
            dest.write_char(b';')
        }
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        use crate::generics::DeepClone as _;
        // PORT NOTE: `css.implementDeepClone` field-walk. `name: &'static [u8]`
        // is an arena-owned slice → identity copy (generics.zig "const strings"
        // rule); `TokenList` carries `#[derive(DeepClone)]`.
        Self {
            name: self.name,
            prelude: self.prelude.deep_clone(bump),
            block: self.block.as_ref().map(|b| b.deep_clone(bump)),
            loc: self.loc,
        }
    }
}

// blocked_on: properties::custom::TokenList::to_css — its body is ``
// gated on Token::to_css + TokenOrValue payload serializers. Thin wrapper here
// so the blocker is named at the actual choke point instead of a generic
// "un-gate rules/unknown.rs" shim; once `TokenList::to_css` un-gates, the
// `#[cfg]` flips and this becomes a passthrough.
#[inline]
fn token_list_to_css(
    list: &TokenList,
    dest: &mut Printer,
    is_custom_property: bool,
) -> Result<(), PrintErr> {
    
    return list.to_css(dest, is_custom_property);
    #[cfg(any())]
    {
        let _ = (list, dest, is_custom_property);
        todo!("blocked_on: properties::custom::TokenList::to_css — Token::to_css un-gate")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/unknown.zig (52 lines)
//   confidence: high
//   todos:      1
//   notes:      `name` field laundered as &'static [u8] until crate-wide 'bump thread; inherent deep_clone real (field-walk port of css.implementDeepClone)
// ──────────────────────────────────────────────────────────────────────────
