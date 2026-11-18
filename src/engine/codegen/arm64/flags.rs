//! What the flags still say.

use bun_engine_asm::Width;
use bun_engine_asm::arm64::{Cc, FloatFlags};

use super::instruction::{Setting, Test};

/// Values go by the numbers that `Operands::identities` gives.
#[derive(Clone, Copy, Default)]
pub(crate) struct KnownFlags {
    set_by: Option<(Setting, [u32; 2])>,
    /// A value that is 1 if the condition holds, and otherwise 0.
    boolean: Option<(u32, Cc)>,
    pub(super) stand_in: StandIn,
}

/// The condition of a boolean that has not been compared with zero, although the next instruction counts on it.
#[derive(Clone, Copy, Default)]
pub(super) struct StandIn(Option<Cc>);

impl KnownFlags {
    /// For arithmetic that has not overflowed.
    pub(super) fn of_result(width: Width, result: u32) -> Self {
        Self {
            set_by: Some((Setting::Zero(width), [result, u32::MAX])),
            ..Self::default()
        }
    }

    pub(super) fn note_boolean(&mut self, value: u32, holds: Cc) {
        self.boolean = Some((value, holds));
    }

    /// Returns whether the flags have to be set.
    pub(super) fn set(&mut self, setting: Setting, operands: [u32; 2]) -> bool {
        let is_tested =
            |&(value, _): &_| matches!(setting, Setting::Zero(_)) && value == operands[0];
        self.stand_in = StandIn(self.boolean.filter(is_tested).map(|(_, holds)| holds));
        let set_by = Some(match setting {
            Setting::Sign(width) => (Setting::Zero(width), operands),
            _ => (setting, operands),
        });
        let is_needed = self.stand_in.0.is_none() && self.set_by != set_by;
        if is_needed {
            (self.set_by, self.boolean) = (set_by, None);
        }
        is_needed
    }
}

impl StandIn {
    /// The condition to test in place of `cc`.
    #[inline]
    pub(super) fn translate(self, cc: Cc) -> Cc {
        match self.0 {
            Some(holds) if matches!(cc, Cc::Ne | Cc::Gt) => holds,
            Some(holds) => holds.inverted(),
            None => cc,
        }
    }

    pub(super) fn translate_flags(self, flags: FloatFlags) -> FloatFlags {
        match flags {
            FloatFlags::One(cc) => FloatFlags::One(self.translate(cc)),
            FloatFlags::Either(..) => flags,
        }
    }

    pub(super) fn translate_test(self, test: Test) -> Test {
        match test {
            Test::Flags(flags) => Test::Flags(self.translate_flags(flags)),
            _ => test,
        }
    }
}
