// The part of internal/core/compileroptions.go and tristate.go that the translated functions read.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum Tristate {
    #[default]
    Unknown,
    False,
    True,
}

impl Tristate {
    pub fn is_true(self) -> bool {
        self == Tristate::True
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct ModuleKind(pub i32);

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct ResolutionMode(pub i32);

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
pub struct ScriptTarget(pub i32);

#[derive(Clone, Default, Debug)]
pub struct CompilerOptions {
    pub strict: Tristate,
    pub strict_null_checks: Tristate,
    pub strict_function_types: Tristate,
    pub no_implicit_any: Tristate,
    pub exact_optional_property_types: Tristate,
    pub no_error_truncation: Tristate,
    pub target: ScriptTarget,
    pub module: ModuleKind,
}

impl CompilerOptions {
    // GetStrictOptionValue: the option itself, else `strict`.
    pub fn get_strict_option_value(&self, value: Tristate) -> bool {
        if value != Tristate::Unknown {
            return value == Tristate::True;
        }
        self.strict == Tristate::True
    }
}
