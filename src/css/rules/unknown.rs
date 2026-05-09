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
            dest.block(|d| {
                d.newline()?;
                block.to_css(d, false)
            })
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

// ported from: src/css/rules/unknown.zig
