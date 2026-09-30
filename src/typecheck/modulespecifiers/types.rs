// modulespecifiers/types.go: the preferences that a caller of the specifier generation passes. The host and checker interfaces of upstream are the program and the checker of this crate.
use crate::core::ResolutionMode;

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum ImportModuleSpecifierPreference {
    #[default]
    None,
    Shortest,
    ProjectRelative,
    Relative,
    NonRelative,
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum ImportModuleSpecifierEndingPreference {
    #[default]
    None,
    Auto,
    Minimal,
    Index,
    Js,
}

#[derive(Clone, Default)]
pub struct UserPreferences {
    pub import_module_specifier_preference: ImportModuleSpecifierPreference,
    pub import_module_specifier_ending: ImportModuleSpecifierEndingPreference,
    pub auto_import_specifier_exclude_regexes: Vec<Vec<u8>>,
}

#[derive(Clone, Copy, Default)]
pub struct ModuleSpecifierOptions {
    pub override_import_mode: ResolutionMode,
}
