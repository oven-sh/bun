//! What a rule is to the rest of the crate.

use super::Severity;

pub(crate) struct Rule {
    /// ESLint's name of the rule: the code of its diagnostics.
    pub(crate) name: &'static str,
    pub(crate) category: RuleCategory,
}

#[derive(Clone, Copy)]
pub(crate) enum RuleCategory {
    /// Code that is wrong or does nothing.
    Correctness,
}

impl RuleCategory {
    /// The level of a rule that no configuration names.
    pub(crate) const fn default_level(self) -> Option<Severity> {
        match self {
            RuleCategory::Correctness => Some(Severity::Error),
        }
    }
}
