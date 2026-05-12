use core::ptr;
use core::ptr::NonNull;

use crate::schema_api as api;
use bun_core::String as BunString;
use bun_core::ZigStringSlice;
use bun_url::URL as ZigURL;

use crate::SourceProvider;
use crate::ZigStackFrame;

/// Represents a JavaScript stack trace
#[repr(C)]
pub struct ZigStackTrace {
    pub source_lines_ptr: *mut BunString,
    pub source_lines_numbers: *mut i32,
    pub source_lines_len: u8,
    pub source_lines_to_collect: u8,

    pub frames_ptr: *mut ZigStackFrame,
    pub frames_len: u8,
    pub frames_cap: u8,

    /// Non-null if `source_lines_*` points into data owned by a JSC::SourceProvider.
    /// If so, then .deref must be called on it to release the memory.
    ///
    /// `Option<NonNull<_>>` niche-optimizes to a single thin pointer, matching
    /// the Zig `?*SourceProvider` ABI exactly.
    pub referenced_source_provider: Option<NonNull<SourceProvider>>,
}

impl ZigStackTrace {
    pub fn from_frames(frames_slice: &mut [ZigStackFrame]) -> ZigStackTrace {
        ZigStackTrace {
            source_lines_ptr: ptr::dangling_mut(),
            source_lines_numbers: ptr::dangling_mut(),
            source_lines_len: 0,
            source_lines_to_collect: 0,

            frames_ptr: frames_slice.as_mut_ptr(),
            frames_len: frames_slice.len().min(usize::from(u8::MAX)) as u8,
            frames_cap: frames_slice.len().min(usize::from(u8::MAX)) as u8,

            referenced_source_provider: None,
        }
    }

    pub fn to_api(
        &self,
        root_path: &[u8],
        origin: Option<&ZigURL<'_>>,
    ) -> Result<api::StackTrace, bun_alloc::AllocError> {
        // Zig: `comptime std.mem.zeroes(api.StackTrace)` — `Default` is the semantic
        // equivalent (`Vec` fields are NonNull and not zero-safe).
        let mut stack_trace = api::StackTrace::default();
        {
            let mut source_lines_iter = self.source_line_iterator();

            let source_line_len = source_lines_iter.get_length();

            if source_line_len > 0 {
                let n_lines = usize::try_from((source_lines_iter.i + 1).max(0)).expect("int cast");
                let mut source_lines: Vec<api::SourceLine> = Vec::with_capacity(n_lines);
                // PORT NOTE: Zig packed all line texts into a single contiguous
                // `source_line_buf` and stored sub-slices in each `SourceLine`.
                // The Rust `api::SourceLine.text` is `Box<[u8]>` (owns its bytes),
                // so each line gets its own allocation instead.
                // PERF(port): one alloc per line vs one shared buffer — profile in Phase B.
                source_lines_iter = self.source_line_iterator();
                while let Some(source) = source_lines_iter.next() {
                    let text = source.text.slice();
                    source_lines.push(api::SourceLine {
                        text: Box::<[u8]>::from(text),
                        line: source.line,
                    });
                    // `defer source.text.deinit()` → handled by Drop on ZigStringSlice at end of scope.
                }
                stack_trace.source_lines = source_lines;
            }
        }
        {
            let frames = self.frames();
            if !frames.is_empty() {
                let mut stack_frames: Vec<api::StackFrame> = Vec::with_capacity(frames.len());

                for frame in frames {
                    stack_frames.push(frame.to_api(root_path, origin)?);
                }
                stack_trace.frames = stack_frames;
            }
        }

        Ok(stack_trace)
    }

    pub fn frames(&self) -> &[ZigStackFrame] {
        // SAFETY: frames_ptr points to a caller-owned buffer of at least frames_len elements
        // (populated by C++ via FFI; see ZigException.zig:111).
        unsafe { bun_core::ffi::slice(self.frames_ptr, self.frames_len as usize) }
    }

    pub fn frames_mutable(&mut self) -> &mut [ZigStackFrame] {
        // SAFETY: frames_ptr points to a caller-owned buffer of at least frames_len elements.
        unsafe { bun_core::ffi::slice_mut(self.frames_ptr, self.frames_len as usize) }
    }

    /// Mutable view of the populated source-line strings (`[0..source_lines_len]`).
    #[inline]
    pub fn source_lines_mut(&mut self) -> &mut [BunString] {
        // SAFETY: `source_lines_ptr` points to a caller-owned buffer of at least
        // `source_lines_len` initialized elements (populated by C++ via FFI;
        // see ZigException.zig:108). The borrow is tied to `&mut self`.
        unsafe { bun_core::ffi::slice_mut(self.source_lines_ptr, self.source_lines_len as usize) }
    }

    /// Immutable view of the populated source-line numbers (`[0..source_lines_len]`).
    #[inline]
    pub fn source_line_numbers(&self) -> &[i32] {
        // SAFETY: `source_lines_numbers` points to a caller-owned buffer of at
        // least `source_lines_len` initialized elements (see ZigException.zig:108).
        unsafe { bun_core::ffi::slice(self.source_lines_numbers, self.source_lines_len as usize) }
    }

    pub fn source_line_iterator(&self) -> SourceLineIterator<'_> {
        let mut i: i32 = -1;
        let nums = self.source_line_numbers();
        for (j, &num) in nums.iter().enumerate() {
            if num >= 0 {
                i = i32::try_from(j).expect("int cast").max(i);
            }
        }
        SourceLineIterator { trace: self, i }
    }
}

pub struct SourceLineIterator<'a> {
    pub trace: &'a ZigStackTrace,
    pub i: i32,
}

pub struct SourceLine {
    pub line: i32,
    pub text: ZigStringSlice,
}

impl<'a> SourceLineIterator<'a> {
    pub fn get_length(&mut self) -> usize {
        let mut count: usize = 0;
        let n = usize::try_from(self.i + 1).expect("int cast");
        // SAFETY: source_lines_ptr points to a caller-owned buffer of at least
        // source_lines_len elements; self.i < source_lines_len by construction in
        // source_line_iterator().
        let lines = unsafe { bun_core::ffi::slice(self.trace.source_lines_ptr, n) };
        for line in lines {
            count += line.length();
        }
        count
    }

    pub fn until_last(&mut self) -> Option<SourceLine> {
        if self.i < 1 {
            return None;
        }
        self.next()
    }

    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> Option<SourceLine> {
        if self.i < 0 {
            return None;
        }

        let idx = usize::try_from(self.i).expect("int cast");
        // SAFETY: idx < source_lines_len by construction in source_line_iterator();
        // both buffers have at least source_lines_len valid elements.
        let (source_line, line_number) = unsafe {
            (
                &*self.trace.source_lines_ptr.add(idx),
                *self.trace.source_lines_numbers.add(idx),
            )
        };
        let result = SourceLine {
            line: line_number,
            text: source_line.to_utf8(),
        };
        self.i -= 1;
        Some(result)
    }
}

// ported from: src/jsc/ZigStackTrace.zig
