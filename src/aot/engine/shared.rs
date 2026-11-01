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

/// What the engine's parser says of the literal `/pattern/flags`, for which it refuses the file that holds it. `None`: nothing.
pub fn describe_regexp_syntax_error(pattern: &[u8], flags: &[u8]) -> Option<Vec<u8>> {
    if !has_compiler() {
        return None;
    }
    let mut sentence = vec![0u8; 128];
    // SAFETY: the engine reads the bytes of the two slices and writes at most `sentence.len()`.
    let length = unsafe {
        Bun__AOT__describeRegExpSyntaxError(
            pattern.as_ptr(),
            pattern.len(),
            flags.as_ptr(),
            flags.len(),
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

/// When the engine loads `image` above `first_image` it copies the string headers of `image` behind those of `first_image`: to which
/// offset there, and from where.
pub fn place_of_string_headers_behind(
    first_image: &[u8],
    image: &[u8],
) -> Option<(usize, core::ops::Range<usize>)> {
    let mut place = [0usize; 3];
    // SAFETY: the engine reads the bytes of the two borrows and writes three words.
    let is_found = unsafe {
        Bun__AOT__placeOfStringHeadersBehind(
            first_image.as_ptr(),
            first_image.len(),
            image.as_ptr(),
            image.len(),
            place.as_mut_ptr(),
        )
    };
    is_found.then(|| (place[0], place[1]..place[1] + place[2]))
}

unsafe extern "C" {
    safe fn Bun__AOT__imageAlignment() -> usize;
    fn Bun__AOT__relocateImage(image: *mut u8, size: usize, address: u64);
    fn Bun__AOT__placeOfStringHeadersBehind(
        first_image: *const u8,
        size_of_first_image: usize,
        image: *const u8,
        size: usize,
        place: *mut usize,
    ) -> bool;
    safe fn Bun__AOT__hasCompiler() -> bool;
    fn Bun__AOT__describeDifferenceOfRuntime(
        description: *const u8,
        size: usize,
        message: *mut u8,
        capacity: usize,
    ) -> usize;
    fn Bun__AOT__describeRegExpSyntaxError(
        pattern: *const u8,
        pattern_size: usize,
        flags: *const u8,
        flags_size: usize,
        message: *mut u8,
        capacity: usize,
    ) -> usize;
}
