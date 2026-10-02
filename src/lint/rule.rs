//! What a rule is to the rest of the crate.

use crate::diagnostic::Category;

pub(crate) struct Rule {
    /// The code of its diagnostics: ESLint's name of the rule when ESLint has it.
    pub(crate) name: &'static str,
    pub(crate) category: RuleCategory,
}

impl Rule {
    /// What its diagnostics are when no configuration names the rule. `None`: the rule is off.
    pub(crate) const fn default_level(&self) -> Option<Category> {
        self.category.default_level()
    }
}

#[derive(Clone, Copy)]
pub(crate) enum RuleCategory {
    /// Code that is wrong or does nothing.
    Correctness,
}

impl RuleCategory {
    /// The level of every rule of the category that no configuration names.
    pub(crate) const fn default_level(self) -> Option<Category> {
        match self {
            RuleCategory::Correctness => Some(Category::Error),
        }
    }
}
