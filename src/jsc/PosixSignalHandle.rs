use core::ptr::NonNull;
use core::sync::atomic::{AtomicU8, AtomicU16, Ordering};

use crate::event_loop::EventLoop;
use crate::{JSGlobalObject, Task, VirtualMachineRef as VirtualMachine};
use bun_event_loop::{Taskable, task_tag};

bun_core::declare_scope!(PosixSignalHandle, hidden);

const BUFFER_SIZE: u16 = 8192;

pub struct PosixSignalHandle {
    signals: [AtomicU8; BUFFER_SIZE as usize],

    /// Producer index (signal handler writes).
    tail: AtomicU16,
    /// Consumer index (main thread reads).
    head: AtomicU16,
}

impl Default for PosixSignalHandle {
    fn default() -> Self {
        Self {
            signals: [const { AtomicU8::new(0) }; BUFFER_SIZE as usize],
            tail: AtomicU16::new(0),
            head: AtomicU16::new(0),
        }
    }
}

impl PosixSignalHandle {
    // `pub const new = bun.TrivialNew(@This());`
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    /// Called by the signal handler (single producer).
    /// Returns `true` if enqueued successfully, or `false` if the ring is full.
    pub fn enqueue(&self, signal: u8) -> bool {
        // Read the current tail and head (Acquire to ensure we have up-to-date values).
        let old_tail = self.tail.load(Ordering::Acquire);
        let head_val = self.head.load(Ordering::Acquire);

        // Compute the next tail (wrapping around BUFFER_SIZE).
        let next_tail = old_tail.wrapping_add(1) % BUFFER_SIZE;

        // Check if the ring is full.
        if next_tail == (head_val % BUFFER_SIZE) {
            // The ring buffer is full.
            // We cannot block or wait here (since we're in a signal handler).
            // So we just drop the signal or log if desired.
            bun_core::scoped_log!(PosixSignalHandle, "signal queue is full; dropping");
            return false;
        }

        // Store the signal into the ring buffer slot (Release to ensure data is visible).
        self.signals[(old_tail % BUFFER_SIZE) as usize].store(signal, Ordering::Release);

        // Publish the new tail (Release so that the consumer sees the updated tail).
        self.tail.store(old_tail.wrapping_add(1), Ordering::Release);

        if let Some(vm) = VirtualMachine::get_main_thread_vm() {
            // SAFETY: `event_loop()` returns the VM-owned EventLoop; live for VM lifetime.
            unsafe { (*(*vm).event_loop()).wakeup() };
        }

        true
    }

    /// Called by the main thread (single consumer).
    /// Returns `None` if the ring is empty, or the next signal otherwise.
    pub fn dequeue(&self) -> Option<u8> {
        // Read the current head and tail.
        let old_head = self.head.load(Ordering::Acquire);
        let tail_val = self.tail.load(Ordering::Acquire);

        // If head == tail, the ring is empty.
        if old_head == tail_val {
            return None; // No available items
        }

        let slot_index = (old_head % BUFFER_SIZE) as usize;
        // Acquire load of the stored signal to get the item.
        let signal = self.signals[slot_index].swap(0, Ordering::AcqRel);

        // Publish the updated head (Release).
        self.head.store(old_head.wrapping_add(1), Ordering::Release);

        Some(signal)
    }

    /// Drain as many signals as possible and enqueue them as tasks in the event loop.
    /// Called by the main thread.
    pub fn drain(&self, event_loop: &mut EventLoop) {
        while let Some(signal) = self.dequeue() {
            // PORT NOTE: Zig stamps the discriminant via `Task.init(&stack_marker)` then
            // overwrites the packed `_ptr` bitfield with `setUintptr(signal)`. The Rust
            // `Task` is a plain `{ tag, ptr }` pair (no bitfield packing), so build it
            // directly — `bun_runtime::dispatch::run_task` unpacks `task.ptr as usize as u8`.
            let task = Task::new(
                <PosixSignalTask as Taskable>::TAG,
                signal as usize as *mut (),
            );
            event_loop.enqueue_task(task);
        }
    }
}

/// This is the signal handler entry point. Calls enqueue on the ring buffer.
/// Note: Must be minimal logic here. Only do atomics & signal-safe calls.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__onPosixSignal(number: i32) {
    #[cfg(unix)]
    {
        let Some(vm) = VirtualMachine::get_main_thread_vm() else { return };
        // SAFETY: `vm` and its event loop are process-lifetime; signal_handler is the
        // boxed ring buffer installed by `Bun__ensureSignalHandler` below.
        unsafe {
            if let Some(handler) = (*(*vm).event_loop()).signal_handler {
                let _ = (*handler.as_ptr()).enqueue(u8::try_from(number).expect("int cast"));
            }
        }
    }
    #[cfg(not(unix))]
    let _ = number;
}

pub struct PosixSignalTask {
    pub number: u8,
}

impl Taskable for PosixSignalTask {
    const TAG: bun_event_loop::TaskTag = task_tag::PosixSignalTask;
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn Bun__onSignalForJS(number: i32, global_object: *mut JSGlobalObject);
}

impl PosixSignalTask {
    // `pub const new = bun.TrivialNew(@This());`
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub fn run_from_js_thread(number: u8, global_object: &JSGlobalObject) {
        // SAFETY: FFI call into C++; `global_object` is a valid live reference.
        // `JSGlobalObject` wraps `UnsafeCell`, so `as_ptr()` yields a `*mut`
        // with write provenance from `&self` — sound for a callee that mutates.
        unsafe {
            Bun__onSignalForJS(i32::from(number), global_object.as_ptr());
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__ensureSignalHandler() {
    #[cfg(unix)]
    {
        if let Some(vm) = VirtualMachine::get_main_thread_vm() {
            // SAFETY: `vm` and its event loop are process-lifetime.
            let this = unsafe { &mut *(*vm).event_loop() };
            if this.signal_handler.is_none() {
                let boxed = PosixSignalHandle::new(PosixSignalHandle::default());
                this.signal_handler = NonNull::new(bun_core::heap::leak(boxed));
            }
        }
    }
}

// ported from: src/jsc/PosixSignalHandle.zig
