use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_regexp::Flags;
use bun_engine_vm::direct::Form;

use super::Checked;
use crate::builder::Builder;

impl Builder<'_> {
    pub(super) fn regexp_in_line(&mut self, call: Checked<'_>) -> Option<Ssa> {
        use Form::*;
        let flag = match call.form {
            flag_has_indices => Flags::HAS_INDICES,
            flag_global => Flags::GLOBAL,
            flag_ignore_case => Flags::IGNORE_CASE,
            flag_multiline => Flags::MULTILINE,
            flag_dot_all => Flags::DOT_ALL,
            flag_unicode => Flags::UNICODE,
            flag_unicode_sets => Flags::UNICODE_SETS,
            flag_sticky => Flags::STICKY,
            _ => return None,
        };
        Some(self.regexp_flag(call.passed[0], flag.bits().into()))
    }

    /// Of a RegExp object, with its tag.
    pub(in crate::builder) fn regexp_flag(&mut self, object: Ssa, bit: u32) -> Ssa {
        let pattern = self.load_pattern(object);
        let flags = self.load_flags(pattern);
        let found = self.ir().and(flags, bit);
        let is_set = self.ir().is_not_zero(found);
        self.box_boolean(is_set)
    }
}
