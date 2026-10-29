use super::generated::{Architecture, LimitId};

impl LimitId {
    pub const fn value(self, architecture: Architecture) -> u64 {
        match architecture {
            Architecture::ARM64 => self.value_on_arm64(),
            Architecture::X86_64 => self.value_on_x86_64(),
        }
    }
}
