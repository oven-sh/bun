//! JavaScriptCore's regular expressions for crates below `bun_jsc`: Yarr's bytecode interpreter, which runs without a
//! VM and on any thread. The C++ side is src/jsc/bindings/RegularExpression.cpp.

use core::ffi::c_void;
use core::ptr::NonNull;

/// `JSC::Yarr::Flags`
pub mod flags {
    pub const HAS_INDICES: u16 = 1 << 0;
    pub const GLOBAL: u16 = 1 << 1;
    pub const IGNORE_CASE: u16 = 1 << 2;
    pub const MULTILINE: u16 = 1 << 3;
    pub const DOT_ALL: u16 = 1 << 4;
    pub const UNICODE: u16 = 1 << 5;
    pub const UNICODE_SETS: u16 = 1 << 6;
    pub const STICKY: u16 = 1 << 7;
}

/// `JSC::Yarr::offsetNoMatch`: where a group starts that took no part in the match.
pub const NO_MATCH: u32 = u32::MAX;

/// `WTF::String::MaxLength`
const MAX_LENGTH: usize = i32::MAX as usize;

/// A string as JavaScriptCore has it.
#[derive(Copy, Clone)]
pub enum Text<'a> {
    /// ASCII is Latin-1.
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

impl Text<'_> {
    /// The characters, how many there are, and whether each is 8 bits. `None`: more than a string can have.
    fn parts(self) -> Option<(*const c_void, u32, bool)> {
        let (characters, length, is_8_bit) = match self {
            Text::Latin1(it) => (it.as_ptr().cast::<c_void>(), it.len(), true),
            Text::Utf16(it) => (it.as_ptr().cast::<c_void>(), it.len(), false),
        };
        (length <= MAX_LENGTH).then_some((characters, length as u32, is_8_bit))
    }
}

/// Why Yarr refuses a pattern. Mirrors `Refusal` in src/jsc/bindings/RegularExpression.cpp.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Error {
    /// The pattern, a quantifier, the number of groups, or what a match would have to remember.
    TooLarge,
    /// A `\p{..}` that its data of Unicode does not have.
    UnknownProperty,
    Syntax,
}

unsafe extern "C" {
    fn Yarr__RegularExpression__compile(
        characters: *const c_void,
        length: u32,
        is_8_bit: bool,
        flags: u16,
        offsets_size: &mut u32,
        refusal: &mut u8,
    ) -> *mut c_void;
    fn Yarr__RegularExpression__exec(
        this: *mut c_void,
        characters: *const c_void,
        length: u32,
        is_8_bit: bool,
        start: u32,
        offsets: *mut u32,
    ) -> bool;
    fn Yarr__RegularExpression__deinit(this: *mut c_void);
}

unsafe extern "Rust" {
    /// Starts JavaScriptCore if nothing has: a match reads its options. Defined in `bun_jsc`, which is above this crate.
    safe fn __bun_yarr_initialize();
}

/// A pattern that is compiled. It does not change, and threads can share it: they take turns.
#[derive(Debug)]
pub struct Compiled {
    handle: NonNull<c_void>,
    offsets_len: u32,
}

// SAFETY: nothing in the C++ object belongs to the thread that made it.
unsafe impl Send for Compiled {}
// SAFETY: a match only writes to the allocator of the C++ object, and holds its lock meanwhile.
unsafe impl Sync for Compiled {}

impl Compiled {
    /// `bits`: of [`flags`].
    pub fn new(pattern: Text<'_>, bits: u16) -> Result<Compiled, Error> {
        static START: std::sync::Once = std::sync::Once::new();
        START.call_once(__bun_yarr_initialize);
        let both = flags::UNICODE | flags::UNICODE_SETS;
        if bits >> 8 != 0 || bits & both == both {
            return Err(Error::Syntax);
        }
        let Some((characters, length, is_8_bit)) = pattern.parts() else {
            return Err(Error::TooLarge);
        };
        let (mut offsets_len, mut refusal) = (0, 0);
        // SAFETY: `characters` is a slice of `length` characters, which C++ does not keep a pointer to.
        let handle = unsafe {
            Yarr__RegularExpression__compile(
                characters,
                length,
                is_8_bit,
                bits,
                &mut offsets_len,
                &mut refusal,
            )
        };
        match (NonNull::new(handle), refusal) {
            (Some(handle), _) => Ok(Compiled {
                handle,
                offsets_len,
            }),
            (None, 1) => Err(Error::TooLarge),
            (None, 2) => Err(Error::UnknownProperty),
            (None, _) => Err(Error::Syntax),
        }
    }

    /// How long the `offsets` of [`Compiled::exec`] have to be: two for the match, two for each group, and some for Yarr.
    #[inline]
    pub fn offsets_len(&self) -> usize {
        self.offsets_len as usize
    }

    /// Whether there is a match that starts at the index `start` or after it: only at `start` with the `y` flag. `false` as
    /// well if Yarr gives the search up, or if `offsets` is too short.
    ///
    /// After a match `offsets` has the start and the end of the match and of each group, as indices in `text`. The start of
    /// a group that took no part is [`NO_MATCH`], and its end can be anything.
    #[inline]
    pub fn exec(&self, text: Text<'_>, start: u32, offsets: &mut [u32]) -> bool {
        let Some((characters, length, is_8_bit)) = text.parts() else {
            return false;
        };
        if start > length || offsets.len() < self.offsets_len() {
            return false;
        }
        // SAFETY: the handle lives until `drop`, `characters` is a slice of `length` characters, and `offsets` has the room that Yarr writes to.
        unsafe {
            Yarr__RegularExpression__exec(
                self.handle.as_ptr(),
                characters,
                length,
                is_8_bit,
                start,
                offsets.as_mut_ptr(),
            )
        }
    }
}

impl Drop for Compiled {
    fn drop(&mut self) {
        // SAFETY: made by `Yarr__RegularExpression__compile`, and nothing uses it after this.
        unsafe { Yarr__RegularExpression__deinit(self.handle.as_ptr()) }
    }
}
