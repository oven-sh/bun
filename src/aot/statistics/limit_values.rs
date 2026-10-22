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

    pub fn lower(&mut self, limit: LimitId, value: u64) {
        assert!(can_be_lowered(limit), "{limit:?}");
        assert!(value <= self.get(limit), "{limit:?}");
        self.values[limit as usize] = value;
    }
}

pub fn fails_build(limit: LimitId) -> bool {
    limit.degrades_to() == DegradesTo::BuildError
}

pub fn can_be_lowered(limit: LimitId) -> bool {
    limit != LimitId::None && !fails_build(limit)
}
