//! JavaScriptCore's regular expressions for crates below `bun_jsc`: Yarr's bytecode interpreter, which runs without a
//! VM and on any thread. The C++ side is src/jsc/bindings/RegularExpression.cpp.

use core::ffi::c_void;
use core::ptr::{NonNull, null_mut};
use core::sync::atomic::{AtomicPtr, Ordering};
use std::sync::OnceLock;

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

/// The C++ object: the bytecode of a pattern, and what a match of it can go back to. So one match at a time.
struct Instance(NonNull<c_void>);

impl Instance {
    /// With how long the `offsets` of a match have to be.
    fn new(pattern: Text<'_>, bits: u16) -> Result<(Instance, u32), Error> {
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
            (Some(handle), _) => Ok((Instance(handle), offsets_len)),
            (None, 1) => Err(Error::TooLarge),
            (None, 2) => Err(Error::UnknownProperty),
            (None, _) => Err(Error::Syntax),
        }
    }

    /// For a [`Place`].
    fn into_raw(self) -> *mut c_void {
        core::mem::ManuallyDrop::new(self).0.as_ptr()
    }
}

impl Drop for Instance {
    fn drop(&mut self) {
        // SAFETY: made by `Yarr__RegularExpression__compile`, and nothing uses it after this.
        unsafe { Yarr__RegularExpression__deinit(self.0.as_ptr()) }
    }
}

/// Where an [`Instance`] that nobody is using waits, or null.
#[derive(Debug, Default)]
struct Place(AtomicPtr<c_void>);

impl Place {
    /// Whichever thread put it there: nothing in the C++ object belongs to the thread that made it or ran it last.
    fn take(&self) -> Option<Instance> {
        if self.0.load(Ordering::Relaxed).is_null() {
            return None;
        }
        NonNull::new(self.0.swap(null_mut(), Ordering::Acquire)).map(Instance)
    }

    /// Gives it back if the place is taken.
    fn put(&self, instance: Instance) -> Option<Instance> {
        if !self.0.load(Ordering::Relaxed).is_null() {
            return Some(instance);
        }
        let raw = instance.into_raw();
        let put = (self.0).compare_exchange(null_mut(), raw, Ordering::Release, Ordering::Relaxed);
        put.err().and_then(|_| NonNull::new(raw)).map(Instance)
    }
}

impl Drop for Place {
    fn drop(&mut self) {
        drop(self.take());
    }
}

/// Cache lines of its own: threads write to their places all the time.
#[derive(Debug, Default)]
#[repr(align(128))]
struct Apart(Place);

/// How often a thread looks for an [`Instance`] that has come back, if it cannot make one: for four seconds, as long as Yarr itself tries.
const PATIENCE: u32 = 4096;

/// The characters of a pattern.
#[derive(Debug)]
enum Pattern {
    Latin1(Box<[u8]>),
    Utf16(Box<[u16]>),
}

/// A pattern that is compiled. It does not change, and threads can share it: each that searches has an [`Instance`] to itself meanwhile.
#[derive(Debug)]
pub struct Compiled {
    pattern: Pattern,
    bits: u16,
    offsets_len: u32,
    /// All that there is until two threads search at the same time.
    first: Place,
    /// At least as many as threads search at a time, or those that find no place compile for every search.
    more: OnceLock<Box<[Apart]>>,
}

impl Compiled {
    /// `bits`: of [`flags`].
    pub fn new(pattern: Text<'_>, bits: u16) -> Result<Compiled, Error> {
        static START: std::sync::Once = std::sync::Once::new();
        START.call_once(__bun_yarr_initialize);
        let both = flags::UNICODE | flags::UNICODE_SETS;
        if bits >> 8 != 0 || bits & both == both {
            return Err(Error::Syntax);
        }
        let (instance, offsets_len) = Instance::new(pattern, bits)?;
        Ok(Compiled {
            pattern: match pattern {
                Text::Latin1(it) => Pattern::Latin1(it.into()),
                Text::Utf16(it) => Pattern::Utf16(it.into()),
            },
            bits,
            offsets_len,
            first: Place(AtomicPtr::new(instance.into_raw())),
            more: OnceLock::new(),
        })
    }

    /// How long the `offsets` of [`Compiled::exec`] have to be: two for the match, two for each group, and some for Yarr.
    #[inline]
    pub fn offsets_len(&self) -> usize {
        self.offsets_len as usize
    }

    /// All places, from the one that this thread is likely to have used last. The address of its stack is only a hint at which thread it is.
    fn places(&self) -> impl Iterator<Item = &Place> {
        let on_the_stack = 0u8;
        let thread = (core::ptr::from_ref(&on_the_stack).addr() >> 18) as u64;
        let hash = (thread.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 40) as usize;
        let more = self.more.get().map_or(&[][..], |it| &**it);
        let (before, from) = more.split_at(hash % more.len().max(1));
        (from.iter().chain(before).map(|it| &it.0)).chain([&self.first])
    }

    /// `None`: all have been in use for seconds, and one more cannot be made.
    fn take(&self) -> Option<Taken<'_>> {
        for round in 0..PATIENCE {
            if let Some(instance) = self.places().find_map(Place::take) {
                return Some(Taken::new(self, instance));
            }
            self.more.get_or_init(|| {
                let cores = std::thread::available_parallelism().map_or(0, usize::from);
                core::iter::repeat_with(Apart::default)
                    .take(cores.max(64))
                    .collect()
            });
            let pattern = match &self.pattern {
                Pattern::Latin1(it) => Text::Latin1(it),
                Pattern::Utf16(it) => Text::Utf16(it),
            };
            // It can fail where the first did not: with less of the stack left. One is only freed when all places are taken, so one comes back.
            match Instance::new(pattern, self.bits) {
                Ok((instance, offsets_len)) => {
                    debug_assert_eq!(offsets_len, self.offsets_len);
                    return Some(Taken::new(self, instance));
                }
                Err(_) if round < 64 => std::thread::yield_now(),
                Err(_) => std::thread::sleep(core::time::Duration::from_millis(1)),
            }
        }
        None
    }

    /// One more than there are places for is freed.
    fn put(&self, instance: Instance) {
        let mut instance = Some(instance);
        for place in self.places() {
            let Some(it) = instance.take() else { break };
            instance = place.put(it);
        }
    }

    /// Whether there is a match that starts at the index `start` or after it: only at `start` with the `y` flag. `false` as
    /// well if Yarr gives the search up, which takes it seconds, if for as long there is no instance to be had, or if `offsets` is too short.
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
        let Some(taken) = self.take() else {
            return false;
        };
        // SAFETY: nobody else has the instance, `characters` is a slice of `length` characters, and `offsets` has the room that Yarr writes to.
        unsafe {
            Yarr__RegularExpression__exec(
                taken.handle.as_ptr(),
                characters,
                length,
                is_8_bit,
                start,
                offsets.as_mut_ptr(),
            )
        }
    }
}

/// An [`Instance`] that a thread has to itself. It goes back when this is dropped.
struct Taken<'a> {
    of: &'a Compiled,
    handle: NonNull<c_void>,
}

impl<'a> Taken<'a> {
    fn new(of: &'a Compiled, instance: Instance) -> Self {
        let handle = core::mem::ManuallyDrop::new(instance).0;
        Taken { of, handle }
    }
}

impl Drop for Taken<'_> {
    fn drop(&mut self) {
        self.of.put(Instance(self.handle));
    }
}
