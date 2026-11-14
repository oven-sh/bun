use bun_sema::check::aot::{QueryLimit, QueryLimits};

use crate::ir::generated::{Architecture, LimitId};

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

    pub fn for_queries(&self) -> QueryLimits {
        QueryLimits(QueryLimit::ALL.map(|limit| self.get(limit_of_queries(limit))))
    }

    #[cfg(test)]
    pub fn lower(&mut self, lowered: LimitId, value: u64) {
        assert!(value <= self.get(lowered), "{lowered:?}");
        self.values[lowered as usize] = value;
    }
}

pub fn limit_of_queries(limit: QueryLimit) -> LimitId {
    match limit {
        QueryLimit::ConstructorParentsFollowed => LimitId::MaxConstructorParentsFollowed,
        QueryLimit::FunctionsGivenThis => LimitId::MaxFunctionsGivenThis,
        QueryLimit::TermsReadForProduct => LimitId::MaxTermsReadForProduct,
        QueryLimit::DeclaredSignatureDepth => LimitId::MaxDeclaredSignatureDepth,
    }
}
