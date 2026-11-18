use core::mem::ManuallyDrop;
use core::ops::Deref;

use bun_engine_macros::FieldOffsets;
use smallvec::SmallVec;

use crate::{
    Gc, GcFree, JsAsyncFunctionGenerator, JsObject, JsPromise, RootVec, StackFrame, StackVisitor,
    Vm, options, root_vec,
};

/// Frames in memory of the global allocator, laid out as the vector of the embedder is. It is no root: whoever has
/// one keeps what the frames refer to alive, or finds out when that dies.
#[derive(FieldOffsets)]
#[repr(C)]
pub struct StackTrace {
    frames: *mut StackFrame,
    capacity: u32,
    length: u32,
}

impl !GcFree for StackTrace {}

impl StackTrace {
    pub(super) const EMPTY: StackTrace = StackTrace {
        frames: core::ptr::null_mut(),
        capacity: 0,
        length: 0,
    };

    #[cfg_attr(rootcheck, rootcheck::allow("goes on in a type that is checked"))]
    fn from_vec(frames: Vec<StackFrame>) -> StackTrace {
        let Ok(capacity @ 1..) = u32::try_from(frames.capacity()) else {
            return Self::EMPTY;
        };
        let (frames, length, _) = frames.into_raw_parts();
        StackTrace {
            frames,
            capacity,
            length: length as u32,
        }
    }

    fn into_vec(self) -> Vec<StackFrame> {
        let this = ManuallyDrop::new(self);
        if this.capacity == 0 {
            return Vec::new();
        }
        // SAFETY: from the global allocator, with room for that many.
        unsafe { Vec::from_raw_parts(this.frames, this.length as usize, this.capacity as usize) }
    }

    pub(super) fn copy_of(frames: &[StackFrame]) -> StackTrace {
        Self::from_vec(frames.to_vec())
    }

    pub fn capture(vm: &Vm, request: StackTraceRequest<'_>) -> StackTrace {
        Self::copy_of(&request.capture(vm))
    }

    /// The async functions that wait for the promise, one for the other.
    pub fn of_awaiters(promise: &JsPromise, limit: usize) -> StackTrace {
        let first = promise.indirect_awaiter();
        // A cycle leads back to the mark, which moves on ever more rarely.
        let (mut mark, mut count) = (first, 1usize);
        let awaiters = core::iter::successors(first, |it| {
            let next = (it.promise().indirect_awaiter()).filter(|&next| Some(next) != mark);
            count += 1;
            if count.is_power_of_two() {
                mark = next;
            }
            next
        });
        let frames = awaiters.filter_map(|it| it.stack_frame());
        Self::from_vec(frames.take(limit).collect())
    }

    pub fn take(&mut self) -> StackTrace {
        core::mem::replace(self, Self::EMPTY)
    }

    /// Keeps the memory.
    pub(super) fn clear(&mut self) {
        self.length = 0;
    }

    pub(super) fn memory_size(&self) -> usize {
        self.capacity as usize * size_of::<StackFrame>()
    }

    pub(super) fn to_root_vec(&self) -> RootVec<StackFrame> {
        let mut copy = root_vec();
        copy.extend_from_slice(self);
        copy
    }
}

impl Deref for StackTrace {
    type Target = [StackFrame];

    #[inline]
    fn deref(&self) -> &[StackFrame] {
        if self.length == 0 {
            return &[];
        }
        // SAFETY: that many are there.
        unsafe { core::slice::from_raw_parts(self.frames, self.length as usize) }
    }
}

impl Drop for StackTrace {
    #[inline]
    fn drop(&mut self) {
        if self.capacity != 0 {
            drop(self.take().into_vec());
        }
    }
}

/// Which frames of the stack to list.
pub struct StackTraceRequest<'a> {
    /// How many of the innermost to leave out.
    pub skip: usize,
    /// The functions that wait for the one that is running come on top, up to as many again.
    pub limit: usize,
    /// Those up to and including the first call of this function are left out, and all if there is none.
    pub below: Option<Gc<JsObject>>,
    /// Is not asked about functions that wait. Does not allocate in the heap.
    pub filter: Option<&'a mut dyn FnMut(&StackFrame) -> bool>,
}

impl StackTraceRequest<'_> {
    #[inline(always)]
    fn capture(mut self, vm: &Vm) -> SmallVec<[StackFrame; 16]> {
        let _defer = vm.heap.defer_collection();
        let mut out = SmallVec::new();
        if self.limit == 0 {
            return out;
        }
        let mut frames = StackVisitor::frames(vm).skip(self.skip);
        if self.below.is_some() {
            frames.find(|frame| frame.callee == self.below);
        }
        // The entry frame of the last frame that is not private, and how many were listed with that.
        let mut last_visible = (0, 0);
        let mut resumed = None;
        let find_resumed = |(entry_frame, position): (usize, usize)| {
            if entry_frame == 0 || !options().use_async_stack_trace {
                return None;
            }
            // SAFETY: that of a frame which is on the stack.
            let context = unsafe { crate::EntryRecord::of(entry_frame) }.context()?;
            Some((context.downcast::<JsAsyncFunctionGenerator>()?, position))
        };
        for frame in frames {
            if frame.entry_frame != last_visible.0 {
                resumed = find_resumed(last_visible).or(resumed);
            }
            if frame.is_private() {
                continue;
            }
            out.push(StackFrame::from(&frame));
            if let Some(filter) = &mut self.filter
                && !out.last().is_some_and(filter)
            {
                out.pop();
            }
            last_visible = (frame.entry_frame, out.len());
            if out.len() >= self.limit {
                break;
            }
        }
        if let Some((function, position)) = resumed.or_else(|| find_resumed(last_visible)) {
            let before = out.len();
            let waiting = function.awaiters().filter_map(|it| it.stack_frame());
            out.extend(waiting.take(self.limit));
            out[position..].rotate_left(before - position);
        }
        out
    }
}

/// See `StackTraceRequest`.
pub fn capture_stack_trace(
    vm: &Vm,
    skip: usize,
    limit: usize,
    below: Option<Gc<JsObject>>,
) -> RootVec<StackFrame> {
    let mut frames = root_vec();
    let request = StackTraceRequest {
        skip,
        limit,
        below,
        filter: None,
    };
    frames.extend_from_slice(&request.capture(vm));
    frames
}
