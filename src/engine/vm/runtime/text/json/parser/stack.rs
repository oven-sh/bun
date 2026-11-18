//! The members of the open objects and arrays. Each run of them follows a word that tells how to go back.

use bun_alloc::AllocError;

use crate::Value;

#[derive(Default)]
pub(super) struct StackMemory {
    /// Only the capacity is used.
    words: Vec<u64>,
    /// The address of the last word.
    last: usize,
}

/// The part of it that is in use, apart from it so that it stays in registers.
pub(super) struct Stack {
    /// The first member of the innermost object or array.
    base: *mut u64,
    /// Inside the memory. What is from `base` up to here are values.
    top: *mut u64,
}

#[repr(C)]
struct Link {
    /// In bytes, from the outer `base` to this word.
    distance: u32,
    context: u32,
}

impl StackMemory {
    const MAX_KEPT_WORDS: usize = 1 << 17;

    /// Returns where `top` has moved to.
    #[cold]
    #[inline(never)]
    extern "rust-cold" fn grow(&mut self, top: *mut u64) -> Result<*mut u64, AllocError> {
        let used = (top.addr() - self.words.as_ptr().addr()) / size_of::<u64>();
        let additional = used.max(128);
        if (used + additional) * size_of::<u64>() > u32::MAX as usize {
            return Err(AllocError);
        }
        // SAFETY: each word below `top` has been written.
        unsafe { self.words.set_len(used) };
        let result = self.words.try_reserve_exact(additional);
        self.words.clear();
        result.map_err(|_| AllocError)?;
        let words = self.words.spare_capacity_mut();
        self.last = words[words.len() - 1..].as_ptr().addr();
        Ok(words[used..].as_mut_ptr().cast())
    }

    #[inline(always)]
    pub(super) fn trim(&mut self) {
        if self.words.capacity() > Self::MAX_KEPT_WORDS {
            *self = StackMemory::default();
        }
    }
}

impl Stack {
    /// # Safety
    /// It is the only one that uses the memory, which is what its methods are given, and which nothing else changes
    /// meanwhile. No collection runs while it is alive.
    #[inline(always)]
    pub(super) unsafe fn new(memory: &mut StackMemory) -> Result<Stack, AllocError> {
        let mut top = memory.words.as_mut_ptr();
        if memory.words.capacity() == 0 {
            top = memory.grow(top)?;
        }
        Ok(Stack { base: top, top })
    }

    #[inline(always)]
    fn raise(&mut self, memory: &mut StackMemory) -> Result<(), AllocError> {
        self.top = self.top.wrapping_add(1);
        if self.top.addr() > memory.last {
            let distance = self.top.addr() - self.base.addr();
            self.top = memory.grow(self.top)?;
            self.base = self.top.wrapping_byte_sub(distance);
        }
        Ok(())
    }

    /// The stack is not to be used after an error.
    #[inline(always)]
    pub(super) fn push(
        &mut self,
        memory: &mut StackMemory,
        value: Value,
    ) -> Result<(), AllocError> {
        // SAFETY: inside the memory.
        unsafe { self.top.write(value.to_bits()) };
        self.raise(memory)
    }

    /// The same.
    #[inline(always)]
    pub(super) fn enter(
        &mut self,
        memory: &mut StackMemory,
        context: u32,
    ) -> Result<(), AllocError> {
        let distance = (self.top.addr() - self.base.addr()) as u32;
        // SAFETY: as above.
        unsafe { self.top.cast::<Link>().write(Link { distance, context }) };
        self.raise(memory)?;
        self.base = self.top;
        Ok(())
    }

    /// Those that have been pushed, and `last`.
    #[inline(always)]
    pub(super) fn members_and(&mut self, last: Value) -> &mut [Value] {
        // SAFETY: values, whose cells are alive.
        unsafe {
            self.top.write(last.to_bits());
            let count = self.top.offset_from_unsigned(self.base) + 1;
            core::slice::from_raw_parts_mut(self.base.cast(), count)
        }
    }

    /// Returns what `enter` was given.
    ///
    /// # Safety
    /// More have been entered than left.
    #[inline(always)]
    pub(super) unsafe fn leave(&mut self) -> u32 {
        // SAFETY: what `enter` has written.
        unsafe {
            self.top = self.base.sub(1);
            let Link { distance, context } = self.top.cast::<Link>().read();
            self.base = self.top.byte_sub(distance as usize);
            context
        }
    }
}
