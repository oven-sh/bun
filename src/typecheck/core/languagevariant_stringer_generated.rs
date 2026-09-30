// internal/core/languagevariant_stringer_generated.go: the String method that stringer generates for LanguageVariant.
use crate::core::languagevariant::LanguageVariant;

const LANGUAGE_VARIANT_NAME: &[u8] = b"LanguageVariantStandardLanguageVariantJSX";

const LANGUAGE_VARIANT_INDEX: [u8; 3] = [0, 23, 41];

impl LanguageVariant {
    pub fn string(self) -> Vec<u8> {
        let i = self.0;
        if let Ok(idx) = usize::try_from(i) {
            if let (Some(&start), Some(&end)) = (
                LANGUAGE_VARIANT_INDEX.get(idx),
                LANGUAGE_VARIANT_INDEX.get(idx + 1),
            ) {
                let name = LANGUAGE_VARIANT_NAME.get(usize::from(start)..usize::from(end));
                return name.unwrap_or(&[]).to_vec();
            }
        }
        format!("LanguageVariant({i})").into_bytes()
    }
}
