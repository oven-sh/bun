use crate::ir::generated::{Architecture, DegradesTo, LimitId};

pub const HOST_ARCHITECTURE: Architecture = if cfg!(target_arch = "x86_64") {
    Architecture::X86_64
} else {
    Architecture::ARM64
};

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct LimitValues {
    values: [u64; LimitId::COUNT],
}

impl LimitValues {
    pub fn for_target(architecture: Architecture) -> LimitValues {
        LimitValues {
            values: LimitId::ALL.map(|limit| limit.value(architecture)),
        }
    }

    pub fn for_host() -> LimitValues {
        LimitValues::for_target(HOST_ARCHITECTURE)
    }

    pub fn get(&self, limit: LimitId) -> u64 {
        self.values[limit as usize]
    }

    /// `LimitId::All` lowers every limit that can be lowered, each to no less than its smallest value.
    pub fn lower(&mut self, lowered: LimitId, value: u64) {
        assert!(can_be_lowered(lowered), "{lowered:?}");
        assert!(value <= self.get(lowered), "{lowered:?}");
        for limit in LimitId::ALL {
            if limit == lowered {
                self.values[limit as usize] = value;
            } else if lowered == LimitId::All && can_be_lowered(limit) {
                self.values[limit as usize] = self.get(limit).min(value.max(limit.smallest()));
            }
        }
    }
}

pub fn fails_build(limit: LimitId) -> bool {
    limit.degrades_to() == DegradesTo::BuildError
}

pub fn can_be_lowered(limit: LimitId) -> bool {
    limit != LimitId::None && !fails_build(limit)
}
