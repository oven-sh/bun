//! Code that has an address.

use core::num::NonZeroUsize;
use core::ops::RangeInclusive;
use core::ptr;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};

use bun_engine_asm::patch::{self, PATCHABLE_MOVE_SIZE, TRANSFER_WORD_BEFORE_END, VENEER_SIZE};
use bun_engine_asm::prelude::*;
use bun_engine_asm::{Code, Target};
use bun_threading::guarded::GuardedLock;

use crate::instruction_cache;
use crate::pages;
use crate::pool::{self, GRANULE, Pool, State};

/// Says whose code it is, in a form of the owner's choice but for the low bits, which tell the owners apart.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Owner(pub NonZeroUsize);

impl Owner {
    pub const KIND_MASK: usize = 7;
    pub const WASM_FUNCTION: usize = 1;
    /// For code whose frames are like those of C functions.
    pub const NATIVE: Owner = Owner(NonZeroUsize::new(2).unwrap());
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Priority {
    /// The engine can do without, so this leaves room for the rest.
    Optional,
    Required,
}

impl Priority {
    fn limit(self) -> usize {
        let capacity = pool::CAPACITY.load(Ordering::Relaxed);
        match self {
            Priority::Optional => capacity / 4 * 3,
            Priority::Required => capacity,
        }
    }
}

/// One while there is hardly any code, two if half of the room for optional code is taken with so many bytes more, and
/// infinite if they do not fit.
pub fn pressure(additional: usize) -> f64 {
    let limit = Priority::Optional.limit();
    let taken = pool::usage().bytes_in_use.saturating_add(additional);
    match limit.saturating_sub(taken) {
        0 => f64::INFINITY,
        left => limit as f64 / left as f64,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct OutOfExecutableMemory;

/// Comes before the code.
#[repr(C)]
struct Header {
    owner: AtomicUsize,
    code_len: usize,
}

const _: () = assert!(size_of::<Header>() == GRANULE);

struct Block {
    start: usize,
    code_len: u32,
}

impl Block {
    fn size(code_len: usize) -> usize {
        GRANULE + code_len.next_multiple_of(GRANULE)
    }
}

impl Drop for Block {
    fn drop(&mut self) {
        let pool = pool::pool_containing(self.start).unwrap();
        let range = self.start..self.start + Self::size(self.code_len as usize);
        // SAFETY: whoever runs code keeps a handle to it.
        unsafe { pool.free(&mut pool.state.lock(), range) };
    }
}

/// Keeps code in memory.
#[derive(Clone)]
pub struct CodeHandle(Arc<Block>);

impl CodeHandle {
    #[inline]
    pub fn start(&self) -> usize {
        self.0.start + GRANULE
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.0.code_len as usize
    }

    #[inline]
    pub fn address(&self, offset: u32) -> usize {
        assert!(offset <= self.0.code_len);
        self.start() + offset as usize
    }

    pub fn addresses(&self) -> core::ops::Range<usize> {
        self.start()..self.start() + self.len()
    }

    #[inline]
    pub fn contains(&self, address: usize) -> bool {
        address.wrapping_sub(self.start()) < self.len()
    }

    pub fn set_owner(&self, owner: Owner) {
        // SAFETY: the handle keeps the block.
        let header = unsafe { header(self.0.start) };
        pages::with_writable_code(|| header.owner.store(owner.0.get(), Ordering::Release));
    }

    /// For routines that other generated code calls, and which run in its frame. `code` is what was linked.
    pub fn set_routines(&self, code: &Code, frames: &NativeFrames) {
        let offsets = |&(start, end)| code.offset_of(start)..code.offset_of(end);
        let frames = frames.closed.iter().map(offsets).collect();
        if let Some(pool) = pool::pool() {
            (pool.state.lock().frames_of_routines).insert(self.0.start, frames);
        }
    }

    /// Tells the observer what the code is called, if there is one.
    pub fn describe(&self, name: impl FnOnce() -> String) {
        if let Some(observer) = OBSERVER.get() {
            observer(self.start(), self.len(), &name());
        }
    }

    /// The same for code that has several routines, given where each starts.
    pub fn describe_parts(&self, parts: impl FnOnce() -> Vec<(usize, String)>) {
        if let Some(observer) = OBSERVER.get() {
            let mut parts = parts();
            parts.sort();
            parts.dedup_by_key(|part| part.0);
            let ends = (parts.iter().skip(1).map(|part| part.0)).chain([self.start() + self.len()]);
            for ((start, name), end) in parts.iter().zip(ends) {
                observer(*start, end - start, name);
            }
        }
    }
}

/// Where routines have a frame like those of C functions, in the order of the code.
#[derive(Default)]
pub struct NativeFrames {
    open: Option<Label>,
    closed: Vec<(Label, Label)>,
}

impl NativeFrames {
    pub fn enter(&mut self, masm: &mut MacroAssembler) {
        masm.enter_frame();
        self.open = Some(masm.mark());
    }

    pub fn leave(&mut self, masm: &mut MacroAssembler) {
        masm.leave_frame();
        let start = self.open.take().expect("entered");
        self.closed.push((start, masm.mark()));
    }
}

/// What the frame pointer points to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FrameInUse {
    /// The frame that the code is for or, at its start and its end, that of the caller.
    Own,
    /// That of the code which has made the call.
    Callers,
    /// One like those of C functions.
    Native,
}

/// Gets the address, length and name of new code.
pub type Observer = fn(usize, usize, &str);

static OBSERVER: OnceLock<Observer> = OnceLock::new();

pub fn set_observer(observer: Observer) {
    OBSERVER.set(observer).expect("there is one observer");
}

/// # Safety
/// The block stays allocated for `'a`.
unsafe fn header<'a>(block: usize) -> &'a Header {
    // SAFETY: `link` wrote it, and changes go through the atomic field.
    unsafe { &*ptr::with_exposed_provenance(block) }
}

fn reaching_word(
    pool: &Pool,
    state: &mut State,
    block: usize,
    old: u32,
    address: usize,
    target: usize,
) -> Option<u32> {
    patch::transfer_word(old, address, target)
        .or_else(|| patch::transfer_word(old, address, pool.veneer(state, block, target)?))
}

static REFUSED: OnceLock<RangeInclusive<u32>> = OnceLock::new();

/// In a build with assertions, there is no room for the optional code with these numbers. The first is number one.
pub fn refuse(numbers: RangeInclusive<u32>) {
    let _ = REFUSED.set(numbers);
}

fn is_refused() -> bool {
    static COUNT: AtomicU32 = AtomicU32::new(1);
    (REFUSED.get()).is_some_and(|it| it.contains(&COUNT.fetch_add(1, Ordering::Relaxed)))
}

/// Copies code to executable memory. `symbol` gives the address of each [`Target::Symbol`].
pub fn link(
    code: &Code,
    priority: Priority,
    mut symbol: impl FnMut(u32) -> usize,
) -> Result<CodeHandle, OutOfExecutableMemory> {
    let pool = pool::pool().ok_or(OutOfExecutableMemory)?;
    if cfg!(debug_assertions) && priority != Priority::Required && is_refused() {
        return Err(OutOfExecutableMemory);
    }
    let bytes = code.bytes();
    let size = Block::size(bytes.len());
    let block = pool.allocate(
        &mut pool.state.lock(),
        size,
        code.alignment() as usize,
        priority.limit(),
    );
    let handle = CodeHandle(Arc::new(Block {
        start: block.ok_or(OutOfExecutableMemory)?,
        code_len: bytes.len() as u32,
    }));

    let mut words = Vec::with_capacity(code.relocations().len());
    for relocation in code.relocations() {
        let target = match relocation.target {
            Target::Address(address) => address,
            Target::Symbol(index) => symbol(index),
        };
        let old = u32::from_le_bytes(*bytes[relocation.offset as usize..].first_chunk().unwrap());
        let address = handle.start() + relocation.offset as usize;
        let word = patch::transfer_word(old, address, target).or_else(|| {
            reaching_word(
                pool,
                &mut pool.state.lock(),
                handle.0.start,
                old,
                address,
                target,
            )
        });
        words.push(word.ok_or(OutOfExecutableMemory)?);
    }

    pages::with_writable_code(|| {
        let header = Header {
            owner: AtomicUsize::new(0),
            code_len: bytes.len(),
        };
        let start = ptr::with_exposed_provenance_mut::<u8>(handle.start());
        // SAFETY: the block is committed, aligned, this large, and not yet known to anyone else. The offsets were
        // checked against `bytes` above.
        unsafe {
            ptr::with_exposed_provenance_mut::<Header>(handle.0.start).write(header);
            ptr::copy_nonoverlapping(bytes.as_ptr(), start, bytes.len());
            for (relocation, word) in code.relocations().iter().zip(words) {
                start
                    .add(relocation.offset as usize)
                    .cast::<[u8; 4]>()
                    .write(word.to_le_bytes());
            }
        }
    });
    instruction_cache::flush(handle.start(), bytes.len());
    pool.publish(handle.0.start);
    Ok(handle)
}

/// # Safety
/// The block at or before `address` is not freed meanwhile.
unsafe fn owner_at(pool: &Pool, address: usize) -> Option<Owner> {
    let block = pool.block_at_or_before(address)?;
    // SAFETY: the caller's.
    let header = unsafe { header(block) };
    let is_inside = address.wrapping_sub(block + GRANULE) < header.code_len;
    NonZeroUsize::new(header.owner.load(Ordering::Acquire))
        .filter(|_| is_inside)
        .map(Owner)
}

/// Takes no lock and allocates nothing, so a signal handler can call it. A call may be the last instruction, so ask
/// about the byte before a return address.
///
/// # Safety
/// If the address is in the memory for generated code, a thread is running the code there or will return to it.
pub unsafe fn owner_of_running_code(address: usize) -> Option<Owner> {
    let pool = pool::pool_containing(address).filter(|pool| !pool.is_veneer(address))?;
    // SAFETY: the address is in a block, and whoever runs code keeps a handle to it.
    unsafe { owner_at(pool, address) }
}

/// While this exists no code is linked or freed.
pub struct Owners(
    Option<(
        &'static Pool,
        GuardedLock<'static, State, bun_threading::Mutex>,
    )>,
);

pub fn lock_owners() -> Owners {
    Owners(pool::pool().map(|pool| (pool, pool.state.lock())))
}

impl Owners {
    /// For any address. Allocates nothing.
    pub fn owner_of(&self, address: usize) -> Option<Owner> {
        let (pool, state) = self.0.as_ref()?;
        if !pool::contains(address) || !pool.is_committed_code(state, address) {
            return None;
        }
        // SAFETY: blocks are freed under the lock.
        unsafe { owner_at(pool, address) }
    }

    /// While the instruction at the address, which is in the memory for generated code, has yet to run. Allocates
    /// nothing.
    pub fn frame_in_use_at(&self, address: usize) -> FrameInUse {
        if self.owner_of(address) == Some(Owner::NATIVE) {
            return FrameInUse::Native;
        }
        if (self.0.as_ref()).is_some_and(|(pool, _)| pool.is_veneer(address)) {
            return FrameInUse::Callers;
        }
        let routines = self.0.as_ref().and_then(|(pool, state)| {
            let block = pool.block_at_or_before(address)?;
            Some((block, state.frames_of_routines.get(&block)?))
        });
        let Some((block, frames)) = routines else {
            return FrameInUse::Own;
        };
        let offset = address.wrapping_sub(block + GRANULE) as u32;
        let next = frames.get(frames.partition_point(|it| it.end <= offset));
        match next.is_some_and(|it| it.contains(&offset)) {
            true => FrameInUse::Native,
            false => FrameInUse::Callers,
        }
    }
}

/// # Safety
/// `end` is the end of a patchable jump or call in code that stays allocated for `'a`.
unsafe fn transfer_word<'a>(end: usize) -> (&'a AtomicU32, usize) {
    let address = end - TRANSFER_WORD_BEFORE_END;
    assert!(pool::contains(address) && address.is_multiple_of(4));
    // SAFETY: aligned, and in code that is allocated. Linked code changes through the functions of this module only.
    (
        unsafe { AtomicU32::from_ptr(ptr::with_exposed_provenance_mut(address)) },
        address,
    )
}

/// Other threads may be running the jump or call. They go to either target.
///
/// # Safety
/// `end` is the end of a patchable jump or call in code that is kept meanwhile, `target` is code that expects to be
/// entered from there, and no other thread changes the same jump or call.
pub unsafe fn set_transfer_target(end: usize, target: usize) -> Result<(), OutOfExecutableMemory> {
    // SAFETY: the caller's.
    let (word, address) = unsafe { transfer_word(end) };
    let old = word.load(Ordering::Relaxed);
    let new = patch::transfer_word(old, address, target).or_else(|| {
        let pool = pool::pool_containing(address)?;
        reaching_word(
            pool,
            &mut pool.state.lock(),
            pool.block_at_or_before(address)?,
            old,
            address,
            target,
        )
    });
    let new = new.ok_or(OutOfExecutableMemory)?;
    pages::with_writable_code(|| word.store(new, Ordering::Release));
    instruction_cache::flush(address, 4);
    Ok(())
}

/// # Safety
/// `end` is the end of a patchable jump or call in code that is kept meanwhile.
pub unsafe fn transfer_target(end: usize) -> usize {
    // SAFETY: the caller's.
    let (word, address) = unsafe { transfer_word(end) };
    let target = patch::transfer_target(word.load(Ordering::Acquire), address);
    if pool::pool_containing(target).is_some_and(|pool| pool.is_veneer(target)) {
        // SAFETY: a veneer ends with its target and lasts as long as the code that jumps to it.
        return unsafe {
            ptr::with_exposed_provenance::<usize>(target + VENEER_SIZE - size_of::<usize>()).read()
        };
    }
    target
}

/// # Safety
/// `address` is a replaceable point in code that is kept meanwhile and that no thread is running, though one may
/// return to it, and `target` is code that expects to be entered from there.
pub unsafe fn replace_with_jump(
    address: usize,
    target: usize,
) -> Result<(), OutOfExecutableMemory> {
    let pool = pool::pool_containing(address).unwrap();
    let jump = patch::replacement_jump(address, target).or_else(|| {
        let veneer = pool.veneer(
            &mut pool.state.lock(),
            pool.block_at_or_before(address)?,
            target,
        )?;
        patch::replacement_jump(address, veneer)
    });
    // SAFETY: the caller's. The assembler left this much room.
    unsafe { pool::write(address, &jump.ok_or(OutOfExecutableMemory)?) };
    Ok(())
}

/// # Safety
/// `end` is the end of a patchable move in code that is kept meanwhile and that no thread is running, though one may
/// return to it, and the code expects `value`.
pub unsafe fn set_move_value(end: usize, value: u64) {
    let address = end - PATCHABLE_MOVE_SIZE;
    assert!(pool::contains(address));
    // SAFETY: the caller's.
    unsafe {
        let old = ptr::with_exposed_provenance::<[u8; PATCHABLE_MOVE_SIZE]>(address).read();
        pool::write(address, &patch::move_bytes(old, value));
    }
}
