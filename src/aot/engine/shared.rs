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

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RegExpLiteralCreation {
    /// From its record, which cannot throw.
    FromRecord,
    /// Its pattern can never be built.
    NeverBuilt,
    /// It is nested too deep for the build to analyze, so whether it can be built depends on the stack of the thread that evaluates it.
    DependsOnStack,
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

/// How the literal `/pattern/flags` is created. The flags must be valid. The pattern need not be: lowering continues after a syntax error is reported, and such a literal is `NeverBuilt`.
pub fn classify_regexp_literal(pattern: &[u8], flags: &[u8]) -> RegExpLiteralCreation {
    if !has_compiler() {
        return RegExpLiteralCreation::FromRecord;
    }
    // SAFETY: the engine reads the bytes of the two slices.
    let answer = unsafe {
        Bun__AOT__classifyRegExpLiteral(
            pattern.as_ptr(),
            pattern.len(),
            flags.as_ptr(),
            flags.len(),
        )
    };
    match answer {
        0 => RegExpLiteralCreation::FromRecord,
        1 => RegExpLiteralCreation::NeverBuilt,
        2 => RegExpLiteralCreation::DependsOnStack,
        _ => unreachable!("Bun__AOT__classifyRegExpLiteral answered {answer}"),
    }
}

/// The whole message of the SyntaxError that the literal `/pattern/flags` throws wherever it is evaluated. The flags must be valid. `None`: it is not `NeverBuilt`, or the message is not at hand.
pub fn describe_regexp_construction_error(pattern: &[u8], flags: &[u8]) -> Option<Vec<u8>> {
    if !has_compiler() {
        return None;
    }
    let mut sentence = vec![0u8; 128];
    // SAFETY: the engine reads the bytes of the two slices and writes at most `sentence.len()`.
    let length = unsafe {
        Bun__AOT__describeRegExpConstructionError(
            pattern.as_ptr(),
            pattern.len(),
            flags.as_ptr(),
            flags.len(),
            sentence.as_mut_ptr(),
            sentence.len(),
        )
    };
    // The program sees the message, so one that was cut short is none.
    if length == 0 || length > sentence.len() {
        return None;
    }
    sentence.truncate(length);
    Some(sentence)
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
    fn Bun__AOT__describeRegExpSyntaxError(
        pattern: *const u8,
        pattern_size: usize,
        flags: *const u8,
        flags_size: usize,
        message: *mut u8,
        capacity: usize,
    ) -> usize;
    fn Bun__AOT__classifyRegExpLiteral(
        pattern: *const u8,
        pattern_size: usize,
        flags: *const u8,
        flags_size: usize,
    ) -> u32;
    fn Bun__AOT__describeRegExpConstructionError(
        pattern: *const u8,
        pattern_size: usize,
        flags: *const u8,
        flags_size: usize,
        message: *mut u8,
        capacity: usize,
    ) -> usize;
}
