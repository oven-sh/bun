use core::sync::atomic::{AtomicU8, AtomicU16, Ordering};

use bun_jsc::{EventLoop, JSGlobalObject, Task, VirtualMachine};

bun_output::declare_scope!(PosixSignalHandle, hidden);

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
            // SAFETY: all-zero is a valid [AtomicU8; N] (AtomicU8 is repr(transparent) over u8).
            signals: unsafe { core::mem::zeroed() },
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
            bun_output::scoped_log!(PosixSignalHandle, "signal queue is full; dropping");
            return false;
        }

        // Store the signal into the ring buffer slot (Release to ensure data is visible).
        self.signals[(old_tail % BUFFER_SIZE) as usize].store(signal, Ordering::Release);

        // Publish the new tail (Release so that the consumer sees the updated tail).
        self.tail.store(old_tail.wrapping_add(1), Ordering::Release);

        VirtualMachine::get_main_thread_vm()
            .unwrap()
            .event_loop()
            .wakeup();

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
            // Example: wrap the signal into a Task structure
            // TODO(port): Zig uses an uninitialized stack PosixSignalTask solely to mint the
            // Task tag, then overwrites the pointer payload with the signal via setUintptr.
            // Phase B should expose Task::from_tag_uintptr(PosixSignalTask, signal) instead.
            let mut posix_signal_task = core::mem::MaybeUninit::<PosixSignalTask>::uninit();
            let mut task = Task::init(posix_signal_task.as_mut_ptr());
            task.set_uintptr(signal as usize);
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
        let vm = VirtualMachine::get_main_thread_vm().unwrap();
        let _ = vm
            .event_loop()
            .signal_handler
            .as_ref()
            .unwrap()
            .enqueue(u8::try_from(number).unwrap());
    }
}

pub struct PosixSignalTask {
    pub number: u8,
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
        // SAFETY: FFI call into C++; global_object is a valid live reference.
        unsafe {
            Bun__onSignalForJS(
                i32::from(number),
                global_object as *const JSGlobalObject as *mut JSGlobalObject,
            );
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__ensureSignalHandler() {
    #[cfg(unix)]
    {
        if let Some(vm) = VirtualMachine::get_main_thread_vm() {
            let this = vm.event_loop();
            if this.signal_handler.is_none() {
                this.signal_handler = Some(PosixSignalHandle::new(PosixSignalHandle::default()));
                // Zig: @memset(&this.signal_handler.?.signals, 0);
                // Already zeroed by Default; kept for parity.
                for slot in this.signal_handler.as_ref().unwrap().signals.iter() {
                    slot.store(0, Ordering::Relaxed);
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/PosixSignalHandle.zig (124 lines)
//   confidence: medium
//   todos:      2
//   notes:      drain() relies on Task::init/set_uintptr tag-pointer hack; EventLoop.signal_handler field access needs &mut shaping in Phase B
// ──────────────────────────────────────────────────────────────────────────
