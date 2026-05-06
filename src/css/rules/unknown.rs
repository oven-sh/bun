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
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/unknown.zig (52 lines)
//   confidence: high
//   todos:      1
//   notes:      `name` field laundered as &'static [u8] until crate-wide 'bump thread; inherent deep_clone provided by deep_clone_shim! in mod.rs until DeepClone derive lands
// ──────────────────────────────────────────────────────────────────────────
