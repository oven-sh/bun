#[derive(Copy, Clone, PartialEq, Eq)]
pub struct ExecutableIdentity(pub [u8; 16]);

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TargetImageForm {
    Absolute,
    PositionIndependent,
}

#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct EngineModuleId(pub u32);

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RejectedOptionWord {
    pub word: Vec<u8>,
    pub sentence: Vec<u8>,
}

pub fn has_compiler() -> bool {
    Bun__AOT__hasCompiler()
}

pub fn image_alignment() -> usize {
    Bun__AOT__imageAlignment()
}

pub fn describe_difference_of_runtime(description: &[u8]) -> Option<Vec<u8>> {
    let mut sentence = vec![0u8; 256];
    // SAFETY: the engine reads `description.len()` bytes and writes at most `sentence.len()`.
    let length = unsafe {
        Bun__AOT__describeDifferenceOfRuntime(
            description.as_ptr(),
            description.len(),
            sentence.as_mut_ptr(),
            sentence.len(),
        )
    };
    sentence.truncate(length);
    (length > 0).then_some(sentence)
}

/// Makes the addresses in `image` those of an image whose first byte the loader puts at `address`.
pub fn relocate_image(image: &mut [u8], address: u64) {
    // SAFETY: the engine reads and writes `image.len()` bytes from the pointer, which the exclusive borrow covers.
    unsafe { Bun__AOT__relocateImage(image.as_mut_ptr(), image.len(), address) }
}

unsafe extern "C" {
    safe fn Bun__AOT__imageAlignment() -> usize;
    fn Bun__AOT__relocateImage(image: *mut u8, size: usize, address: u64);
    safe fn Bun__AOT__hasCompiler() -> bool;
    fn Bun__AOT__describeDifferenceOfRuntime(
        description: *const u8,
        size: usize,
        message: *mut u8,
        capacity: usize,
    ) -> usize;
}
