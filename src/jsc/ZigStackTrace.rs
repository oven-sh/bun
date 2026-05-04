use core::ptr;

use bun_str::String as BunString;
use bun_str::Utf8Slice;
use bun_schema::api;
use bun_url::URL as ZigURL;

use crate::RefPtr;
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
    pub referenced_source_provider: Option<RefPtr<SourceProvider>>,
}

impl ZigStackTrace {
    pub fn from_frames(frames_slice: &mut [ZigStackFrame]) -> ZigStackTrace {
        ZigStackTrace {
            source_lines_ptr: ptr::dangling_mut(),
            source_lines_numbers: ptr::dangling_mut(),
            source_lines_len: 0,
            source_lines_to_collect: 0,

            frames_ptr: frames_slice.as_mut_ptr(),
            frames_len: frames_slice.len().min(u8::MAX as usize) as u8,
            frames_cap: frames_slice.len().min(u8::MAX as usize) as u8,

            referenced_source_provider: None,
        }
    }

    pub fn to_api(
        &self,
        root_path: &[u8],
        origin: Option<&ZigURL>,
    ) -> Result<api::StackTrace, bun_core::Error> {
        // TODO(port): narrow error set
        // Zig: `comptime std.mem.zeroes(api.StackTrace)` — assuming Default == all-zero for the api type.
        let mut stack_trace = api::StackTrace::default();
        {
            let mut source_lines_iter = self.source_line_iterator();

            let source_line_len = source_lines_iter.get_length();

            if source_line_len > 0 {
                let n_lines = usize::try_from((source_lines_iter.i + 1).max(0)).unwrap();
                let mut source_lines: Vec<api::SourceLine> = Vec::with_capacity(n_lines);
                // TODO(port): in Zig, each api::SourceLine.text is a slice into this single
                // contiguous buffer (caller-allocator-owned). Phase B must decide whether
                // api::SourceLine owns its bytes (Box<[u8]>) or borrows from a sibling buffer.
                let mut source_line_buf: Vec<u8> = vec![0u8; source_line_len];
                source_lines_iter = self.source_line_iterator();
                let mut remain_buf: &mut [u8] = &mut source_line_buf[..];
                let mut i: usize = 0;
                while let Some(source) = source_lines_iter.next() {
                    let text = source.text.as_bytes();
                    // `defer source.text.deinit()` → handled by Drop on Utf8Slice at end of scope.
                    remain_buf[..text.len()].copy_from_slice(text);
                    // PORT NOTE: reshaped for borrowck — split remain_buf instead of two overlapping slices.
                    let (copied_line, rest) = remain_buf.split_at_mut(text.len());
                    remain_buf = rest;
                    source_lines.push(api::SourceLine {
                        // TODO(port): `copied_line` borrows `source_line_buf`; see ownership note above.
                        text: copied_line,
                        line: source.line,
                    });
                    i += 1;
                    let _ = i;
                }
                let _ = source_line_buf; // TODO(port): ownership of backing buffer must transfer into stack_trace
                stack_trace.source_lines = source_lines;
            }
        }
        {
            let frames = self.frames();
            if !frames.is_empty() {
                let mut stack_frames: Vec<api::StackFrame> = Vec::with_capacity(frames.len());

                for frame in frames.iter() {
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
        unsafe { core::slice::from_raw_parts(self.frames_ptr, self.frames_len as usize) }
    }

    pub fn frames_mutable(&mut self) -> &mut [ZigStackFrame] {
        // SAFETY: frames_ptr points to a caller-owned buffer of at least frames_len elements.
        unsafe { core::slice::from_raw_parts_mut(self.frames_ptr, self.frames_len as usize) }
    }

    pub fn source_line_iterator(&self) -> SourceLineIterator<'_> {
        let mut i: i32 = -1;
        // SAFETY: source_lines_numbers points to a caller-owned buffer of at least
        // source_lines_len elements (see ZigException.zig:108).
        let nums = unsafe {
            core::slice::from_raw_parts(self.source_lines_numbers, self.source_lines_len as usize)
        };
        for (j, &num) in nums.iter().enumerate() {
            if num >= 0 {
                i = i32::try_from(j).unwrap().max(i);
            }
        }
        SourceLineIterator { trace: self, i }
    }
}

pub struct SourceLineIterator<'a> {
    pub trace: &'a ZigStackTrace,
    pub i: i32,
}

pub struct SourceLine<'a> {
    pub line: i32,
    pub text: Utf8Slice<'a>,
}

impl<'a> SourceLineIterator<'a> {
    pub fn get_length(&mut self) -> usize {
        let mut count: usize = 0;
        let n = usize::try_from(self.i + 1).unwrap();
        // SAFETY: source_lines_ptr points to a caller-owned buffer of at least
        // source_lines_len elements; self.i < source_lines_len by construction in
        // source_line_iterator().
        let lines = unsafe { core::slice::from_raw_parts(self.trace.source_lines_ptr, n) };
        for line in lines {
            count += line.length();
        }
        count
    }

    pub fn until_last(&mut self) -> Option<SourceLine<'a>> {
        if self.i < 1 {
            return None;
        }
        self.next()
    }

    pub fn next(&mut self) -> Option<SourceLine<'a>> {
        if self.i < 0 {
            return None;
        }

        let idx = usize::try_from(self.i).unwrap();
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ZigStackTrace.zig (150 lines)
//   confidence: medium
//   todos:      4
//   notes:      to_api() shared source_line_buf → per-line slice ownership needs Phase B decision; RefPtr<SourceProvider> assumed in crate::
// ──────────────────────────────────────────────────────────────────────────
