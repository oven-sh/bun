// internal/core/languagevariant.go

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct LanguageVariant(pub i32);

impl LanguageVariant {
    pub const STANDARD: LanguageVariant = LanguageVariant(0);
    pub const JSX: LanguageVariant = LanguageVariant(1);
}
