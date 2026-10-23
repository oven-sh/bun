#[path = "../engine/shared.rs"]
pub mod shared;

use bun_trim::UsedFeatures;

pub use self::shared::{
    EngineModuleId, ExecutableIdentity, RejectedOptionWord, TargetImageForm,
    describe_difference_of_runtime, has_compiler, image_alignment, relocate_image,
};
use crate::Opaque;
use crate::linked;

pub struct EngineResult(pub Opaque);

impl EngineResult {
    pub fn image(&self) -> Option<&[u8]> {
        linked::bun_aot_image(self)
    }

    pub fn entry_module_ids(&self) -> &[EngineModuleId] {
        linked::bun_aot_entry_module_ids(self)
    }

    pub fn symbols(&self) -> &[u8] {
        linked::bun_aot_symbols(self)
    }
}

pub fn used_features(result: &EngineResult) -> UsedFeatures {
    linked::bun_aot_used_features(result)
}

pub fn check_option_word(
    earlier_words: &[Box<[u8]>],
    word: &[u8],
) -> Result<(), RejectedOptionWord> {
    linked::bun_aot_check_option_word(earlier_words, word)
}
