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
    FromRecord,
    NeverBuilt,
    DependsOnStack,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum StoredStringsForm {
    /// Each string as UTF-8, followed by a zero byte.
    ZeroTerminated,
    /// An object for each string, with its place in the file, and for each run of bytes outside the strings.
    JsonLines,
}

pub struct StoredStrings {
    /// 0: nothing but zeros lies beside the strings. 1: a byte that no string covers is not zero. 2: the file can't be read.
    pub verdict: u32,
    pub strings: Vec<u8>,
    pub report: Vec<u8>,
}

pub fn has_compiler() -> bool {
    Bun__AOT__hasCompiler()
}

/// The strings that the compiled images in `file`, a finished executable, store.
pub fn read_stored_strings(file: &[u8], form: StoredStringsForm) -> StoredStrings {
    unsafe extern "C" fn take(
        stored: *mut core::ffi::c_void,
        strings: *const u8,
        strings_size: usize,
        report: *const u8,
        report_size: usize,
    ) {
        let copy = |bytes: *const u8, size: usize| match size {
            0 => Vec::new(),
            // SAFETY: the engine hands `size` bytes that live until this function returns.
            _ => unsafe { core::slice::from_raw_parts(bytes, size) }.to_vec(),
        };
        // SAFETY: the pointer that `read_stored_strings` passed, which nothing else uses meanwhile.
        let stored = unsafe { &mut *stored.cast::<StoredStrings>() };
        (stored.strings, stored.report) = (copy(strings, strings_size), copy(report, report_size));
    }
    let mut stored = StoredStrings {
        verdict: 2,
        strings: Vec::new(),
        report: Vec::new(),
    };
    // SAFETY: the engine reads `file.len()` bytes and calls `take` once, with `stored`, before it returns.
    stored.verdict = unsafe {
        Bun__AOT__readStoredStrings(
            file.as_ptr(),
            file.len(),
            form as u8,
            (&raw mut stored).cast(),
            take,
        )
    };
    stored
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
    if length == 0 || length > sentence.len() {
        return None;
    }
    sentence.truncate(length);
    Some(sentence)
}

pub fn relocate_image(image: &mut [u8], address: u64) {
    // SAFETY: the engine reads and writes `image.len()` bytes from the pointer, which the exclusive borrow covers.
    unsafe { Bun__AOT__relocateImage(image.as_mut_ptr(), image.len(), address) }
}

unsafe extern "C" {
    safe fn Bun__AOT__imageAlignment() -> usize;
    fn Bun__AOT__relocateImage(image: *mut u8, size: usize, address: u64);
    safe fn Bun__AOT__hasCompiler() -> bool;
    fn Bun__AOT__readStoredStrings(
        file: *const u8,
        size: usize,
        form: u8,
        stored: *mut core::ffi::c_void,
        take: unsafe extern "C" fn(*mut core::ffi::c_void, *const u8, usize, *const u8, usize),
    ) -> u32;
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
