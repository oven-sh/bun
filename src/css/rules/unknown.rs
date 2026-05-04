use bun_css::css_parser as css;
use bun_css::css_parser::{Location, Printer, PrintErr, TokenList};
// `pub const css_values = @import("../values/values.zig");` — unused in this file; drop.

use bun_alloc::Arena; // bumpalo::Bump re-export (CSS is an AST/arena crate)

/// An unknown at-rule, stored as raw tokens.
pub struct UnknownAtRule {
    /// The name of the at-rule (without the @).
    // TODO(port): arena lifetime — Zig `[]const u8` backed by parser arena.
    pub name: *const [u8],
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

        dest.write_char('@')?;
        // SAFETY: `name` points into the parser arena which outlives printing.
        dest.write_str(unsafe { &*self.name })?;

        if self.prelude.v.len() > 0 {
            dest.write_char(' ')?;
            self.prelude.to_css(dest, false)?;
        }

        if let Some(block) = &self.block {
            dest.whitespace()?;
            dest.write_char('{')?;
            dest.indent();
            dest.newline()?;
            block.to_css(dest, false)?;
            dest.dedent();
            dest.newline()?;
            dest.write_char('}')?;
        } else {
            dest.write_char(';')?;
        }
        Ok(())
    }

    pub fn deep_clone(&self, bump: &Arena) -> Self {
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/unknown.zig (52 lines)
//   confidence: medium
//   todos:      1
//   notes:      `name` field is arena-backed slice; Phase B should thread `'bump` lifetime through CSS rule structs. `implement_deep_clone` is a comptime-reflection helper — likely becomes a derive/trait in Phase B.
// ──────────────────────────────────────────────────────────────────────────
