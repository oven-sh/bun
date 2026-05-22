// ─── StackCheck (from bun.zig) ───────────────────────────────────────────
// Thin FFI wrapper; configure_thread() is all output.rs needs.
#[derive(Clone, Copy)]
pub struct StackCheck {
    cached_stack_end: usize,
}
unsafe extern "C" {
    /// No preconditions; initializes thread-local stack bookkeeping.
    safe fn Bun__StackCheck__initialize();
    /// No preconditions; returns the cached stack-bound pointer for this thread.
    safe fn Bun__StackCheck__getMaxStack() -> *mut core::ffi::c_void;
}
impl Default for StackCheck {
    /// Zig `.{}` — `cached_stack_end` defaults to `0`, so
    /// `is_safe_to_recurse()` always reports true until `init`/`update`.
    #[inline]
    fn default() -> Self {
        Self {
            cached_stack_end: 0,
        }
    }
}
impl StackCheck {
    #[inline]
    pub fn configure_thread() {
        Bun__StackCheck__initialize()
    }
    #[inline]
    pub fn init() -> Self {
        Self {
            cached_stack_end: Bun__StackCheck__getMaxStack() as usize,
        }
    }
    #[inline]
    pub fn update(&mut self) {
        self.cached_stack_end = Bun__StackCheck__getMaxStack() as usize;
    }
    /// Is there enough stack space to safely recurse?
    /// Zig: `> 256K` on Windows, `> 128K` elsewhere (bun.zig:3762).
    #[inline]
    pub fn is_safe_to_recurse(self) -> bool {
        // Zig uses `-|` (saturating sub): if probe < end (already past limit),
        // result saturates to 0 → "not safe". wrapping_sub would yield a huge
        // positive and incorrectly return true.
        let remaining = Self::frame_address().saturating_sub(self.cached_stack_end);
        let threshold: usize = if cfg!(windows) {
            256 * 1024
        } else {
            128 * 1024
        };
        remaining > threshold
    }

    /// Like [`is_safe_to_recurse`] but reserves `extra` bytes of additional
    /// headroom on top of the platform threshold. Use when the code after the
    /// check makes a deep call (e.g. into the transpiler) before reaching the
    /// next check — on Windows a single stack `PathBuffer` is ~96 KB, so a
    /// chain of two or three exceeds the default 256 KB headroom.
    #[inline]
    pub fn is_safe_to_recurse_with_extra(self, extra: usize) -> bool {
        let remaining = Self::frame_address().saturating_sub(self.cached_stack_end);
        let threshold: usize = if cfg!(windows) {
            256 * 1024
        } else {
            128 * 1024
        };
        remaining > threshold.saturating_add(extra)
    }

    /// Approximate the current stack position. Reads the stack-pointer
    /// register so the result is on the real machine stack — taking the
    /// address of a local lands on ASAN's heap-backed fake stack when
    /// use-after-return detection is on, which makes the comparison against
    /// `cached_stack_end` useless.
    ///
    /// Zig uses `@frameAddress()` (rbp/x29), but Zig builds always keep frame
    /// pointers. Rust release builds omit them, leaving rbp/x29 as a
    /// general-purpose register with arbitrary contents — reading it there
    /// makes `is_safe_to_recurse()` spuriously fail at depth 0. The stack
    /// pointer is always valid and is what we actually want to measure.
    #[inline(always)]
    fn frame_address() -> usize {
        #[cfg(target_arch = "x86_64")]
        {
            let sp: usize;
            // SAFETY: reading rsp is side-effect-free.
            unsafe {
                core::arch::asm!("mov {}, rsp", out(reg) sp, options(nomem, nostack, preserves_flags))
            };
            sp
        }
        #[cfg(target_arch = "aarch64")]
        {
            let sp: usize;
            // SAFETY: reading sp is side-effect-free.
            unsafe {
                core::arch::asm!("mov {}, sp", out(reg) sp, options(nomem, nostack, preserves_flags))
            };
            sp
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            let probe = 0u8;
            core::ptr::from_ref::<u8>(&probe) as usize
        }
    }
}
