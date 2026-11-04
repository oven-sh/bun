#[path = "../engine/shared.rs"]
pub mod shared;

pub use self::shared::{
    EngineModuleId, ExecutableIdentity, RejectedOptionWord, TargetImageForm,
    describe_difference_of_runtime, image_alignment, relocate_image,
};
use crate::Opaque;
use crate::linked;
pub use crate::linked::{
    bun_aot_check_option_word as check_option_word, bun_aot_used_features as used_features,
};

/// Known when Bun is compiled if it is built without the compiler, so that nothing behind the question is linked.
#[inline(always)]
pub fn has_compiler() -> bool {
    !cfg!(feature = "absent") && shared::has_compiler()
}

pub struct EngineResult(pub Opaque);

impl EngineResult {
    pub fn image(&self) -> Option<&[u8]> {
        linked::bun_aot_image(self)
    }

    /// For the writer of an executable: the image, whose addresses it makes those of the executable where the image lies, and the symbols.
    pub fn image_mut_and_symbols(&mut self) -> (Option<&mut [u8]>, &[u8]) {
        linked::bun_aot_image_mut_and_symbols(self)
    }

    pub fn entry_module_ids(&self) -> &[EngineModuleId] {
        linked::bun_aot_entry_module_ids(self)
    }
}
