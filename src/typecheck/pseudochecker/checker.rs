// pseudochecker/checker.go: the checker that types a declaration from its syntax alone.
#[derive(Clone, Copy, Default)]
pub struct PseudoChecker {
    pub(crate) strict_null_checks: bool,
    pub(crate) exact_optional_property_types: bool,
}

pub fn new_pseudo_checker(
    strict_null_checks: bool,
    exact_optional_property_types: bool,
) -> PseudoChecker {
    PseudoChecker {
        strict_null_checks,
        exact_optional_property_types,
    }
}
