use crate::css_rules::Location;
use crate::properties::custom::TokenList;
use crate::{PrintErr, Printer};

/// An unknown at-rule, stored as raw tokens.
pub struct UnknownAtRule {
    /// The name of the at-rule (without the @).
    // TODO: arena lifetime — slice backed by parser arena.
    pub(crate) name: &'static [u8],
    /// The prelude of the rule.
    pub(crate) prelude: TokenList,
    /// The contents of the block, if any.
    pub(crate) block: Option<TokenList>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl UnknownAtRule {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_char(b'@')?;
        dest.write_str(self.name)?;

        if !self.prelude.v.is_empty() {
            dest.write_char(b' ')?;
            self.prelude.to_css(dest)?;
        }

        if let Some(block) = &self.block {
            dest.block(|d| {
                d.newline()?;
                block.to_css(d)
            })
        } else {
            dest.write_char(b';')
        }
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        use crate::generics::DeepClone as _;
        // `name` is an arena-owned slice → identity copy; `TokenList`
        // carries `#[derive(DeepClone)]`.
        Self {
            name: self.name,
            prelude: self.prelude.deep_clone(bump),
            block: self.block.as_ref().map(|b| b.deep_clone(bump)),
            loc: self.loc,
        }
    }
}
