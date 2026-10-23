use crate::css_rules::Location;
use crate::properties::custom::{RawTokens, RawTokensContext};
use crate::{PrintErr, Printer};

/// An unknown at-rule, stored as raw tokens.
pub struct UnknownAtRule {
    /// The name of the at-rule (without the @).
    // TODO: arena lifetime — slice backed by parser arena.
    pub name: &'static [u8],
    /// The prelude of the rule.
    pub(crate) prelude: RawTokens,
    /// The contents of the block, if any.
    pub(crate) block: Option<RawTokens>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl UnknownAtRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_char(b'@')?;
        dest.serialize_identifier(self.name)?;

        if !self.prelude.v.is_empty() {
            dest.write_char(b' ')?;
            self.prelude.to_css(dest, RawTokensContext::AtRule)?;
        }

        if let Some(block) = &self.block {
            dest.block(|d| {
                d.newline()?;
                block.to_css(d, RawTokensContext::AtRule)
            })
        } else {
            dest.write_char(b';')
        }
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        use crate::generics::DeepClone as _;
        // `name` is an arena-owned slice → identity copy; `RawTokens`
        // carries `#[derive(DeepClone)]`.
        Self {
            name: self.name,
            prelude: self.prelude.deep_clone(bump),
            block: self.block.as_ref().map(|b| b.deep_clone(bump)),
            loc: self.loc,
        }
    }
}
