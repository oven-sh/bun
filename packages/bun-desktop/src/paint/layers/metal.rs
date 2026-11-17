use std::cell::{Cell, RefCell};
use std::collections::hash_map::Entry;
use std::ffi::{CString, c_char, c_void};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use super::core_animation::{Surface, Tree};
use super::{Instance, Pass, SLOTS, Sample, Target as _};
use crate::error::{Context as _, Result, ensure};
use crate::hash::FastMap;
use crate::paint::arena::Chunk;
use crate::platform::macos::{Object, failure};

#[repr(C)]
struct Batch {
    offset: usize,
    count: usize,
    slots: [*const c_void; SLOTS],
}

#[repr(C)]
struct Target {
    texture: *const c_void,
    cell: [f32; 4],
    batches: usize,
}

unsafe extern "C" {
    fn bd_gpu_start(shader: *const c_char) -> *mut c_char;
    fn bd_gpu_buffer(start: *mut u8, length: usize) -> Option<Object>;
    safe fn bd_gpu_rest();
    safe fn bd_gpu_finish() -> *mut c_char;
    safe fn bd_gpu_contents(buffer: &c_void) -> *mut c_void;
    safe fn bd_gpu_texture(surface: &c_void) -> Option<Object>;
    fn bd_gpu_draw(
        instances: &c_void,
        passes: *const Target,
        count: usize,
        batches: *const Batch,
    ) -> *mut c_char;
}

static IS_USABLE: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub struct Buffers {
    instances: Option<(Object, usize)>,
}

thread_local! {
    static HAS_SPOILED: Cell<bool> = const { Cell::new(false) };
    /// The buffer is released before the memory that it wraps.
    static CHUNKS: RefCell<FastMap<u64, (Object, Arc<Chunk>)>> = RefCell::default();
}

fn try_to_draw(
    buffers: &mut Buffers,
    instances: &[Instance],
    passes: &[Pass<Surface>],
) -> Result<()> {
    CHUNKS.with_borrow_mut(|chunks| draw_with(chunks, buffers, instances, passes))
}

fn draw_with(
    chunks: &mut FastMap<u64, (Object, Arc<Chunk>)>,
    buffers: &mut Buffers,
    instances: &[Instance],
    passes: &[Pass<Surface>],
) -> Result<()> {
    let length = size_of_val(instances).max(1);
    if buffers
        .instances
        .as_ref()
        .is_none_or(|(_, capacity)| *capacity < length)
    {
        let capacity = length.next_power_of_two().max(1 << 16);
        // SAFETY: it allocates.
        buffers.instances = unsafe { bd_gpu_buffer(std::ptr::null_mut(), capacity) }
            .map(|buffer| (buffer, capacity));
    }
    let (all, _) = buffers
        .instances
        .as_ref()
        .context("there is no memory for the instances")?;
    // SAFETY: it is long enough, and the last draw has completed.
    unsafe {
        std::ptr::copy_nonoverlapping(
            instances.as_ptr(),
            bd_gpu_contents(all).cast(),
            instances.len(),
        )
    };
    let (mut targets, mut batches) = (Vec::new(), Vec::new());
    for pass in passes {
        let before = batches.len();
        for batch in pass
            .batches
            .iter()
            .filter(|batch| !batch.instances.is_empty())
        {
            let mut slots = [&raw const **all; SLOTS];
            for (slot, chunk) in slots.iter_mut().zip(&batch.slots) {
                if let Entry::Vacant(entry) = chunks.entry(chunk.id) {
                    // SAFETY: whole pages of one mapping, which outlives the buffer.
                    let buffer = unsafe { bd_gpu_buffer(chunk.start, chunk.len) };
                    entry.insert((
                        buffer.context("the memory cannot be shared")?,
                        chunk.clone(),
                    ));
                }
                *slot = &raw const *chunks[&chunk.id].0;
            }
            batches.push(Batch {
                offset: batch.instances.start * size_of::<Instance>(),
                count: batch.instances.len(),
                slots,
            });
        }
        let texture = pass
            .surface
            .texture
            .get_or_init(|| bd_gpu_texture(&pass.surface.surface));
        targets.push(Target {
            texture: &raw const **texture.as_ref().context("the surface cannot be drawn on")?,
            cell: [
                pass.rect.left as f32,
                pass.rect.top as f32,
                pass.rect.width() as f32,
                pass.rect.height() as f32,
            ],
            batches: batches.len() - before,
        });
    }
    // SAFETY: the arguments that the shader declares. The instances only point into their blocks.
    unsafe {
        failure(bd_gpu_draw(
            all,
            targets.as_ptr(),
            targets.len(),
            batches.as_ptr(),
        ))
    }
}

/// Fails unless it draws what the CPU paints.
fn set_up() -> Result<()> {
    let shader = CString::new(include_str!("shader.metal"))?;
    // SAFETY: a string.
    unsafe { failure(bd_gpu_start(shader.as_ptr())) }?;
    let surface = Surface::new(Sample::WIDTH, Sample::HEIGHT).context("there is no surface")?;
    let sample = Sample::new();
    let (instances, pass) = sample.pass(&surface);
    let mut buffers = Buffers::default();
    try_to_draw(&mut buffers, &instances, &[pass])?;
    // SAFETY: an answer.
    unsafe { failure(bd_gpu_finish()) }?;
    let difference = sample.difference(&Tree::lock(&surface, false));
    Tree::unlock(&surface, false);
    ensure!(difference <= 6, "its pixels are off by {difference}");
    Ok(())
}

/// It can fail for what another process has done, or for having slept.
fn get_ready() {
    const MAX_ATTEMPTS: u32 = 4;
    const PAUSE: Duration = Duration::from_secs(10);
    static IS_STARTING: AtomicBool = AtomicBool::new(false);
    thread_local! {
        static ATTEMPTS: Cell<(u32, Option<Instant>)> = const { Cell::new((0, None)) };
    }
    let (count, last) = ATTEMPTS.get();
    if count == MAX_ATTEMPTS
        || last.is_some_and(|it| it.elapsed() < PAUSE)
        || IS_STARTING.swap(true, Ordering::Acquire)
    {
        return;
    }
    ATTEMPTS.set((count + 1, Some(Instant::now())));
    let start = || {
        let time = Instant::now();
        match set_up() {
            Ok(()) => {
                crate::diagnostics::log!("the GPU is ready after {:?}", time.elapsed());
                IS_USABLE.store(true, Ordering::Release);
            }
            Err(error) => crate::diagnostics::log!("the GPU is not used: {error:#}"),
        }
        IS_STARTING.store(false, Ordering::Release);
    };
    drop(std::thread::Builder::new().name("GPU".into()).spawn(start));
}

/// Getting ready takes time and memory, so not for a frame or two, and not while the app starts.
pub fn is_ready() -> bool {
    const IN_A_ROW: u32 = 4;
    thread_local! {
        static ASKED: Cell<(Option<Instant>, u32)> = const { Cell::new((None, 0)) };
    }
    let is_ready = IS_USABLE.load(Ordering::Acquire);
    if !is_ready {
        let (last, times) = ASKED.get();
        let times = if last.is_some_and(|it| it.elapsed() < crate::host::interval() * 3) {
            times + 1
        } else {
            0
        };
        ASKED.set((Some(Instant::now()), times));
        if times >= IN_A_ROW {
            get_ready();
        }
    }
    is_ready
}

/// Before anything that the last draws use is touched.
pub fn finish() {
    // SAFETY: an answer.
    if IS_USABLE.load(Ordering::Acquire) && !succeeded(unsafe { failure(bd_gpu_finish()) }) {
        HAS_SPOILED.set(true);
    }
    CHUNKS.with_borrow_mut(|chunks| chunks.retain(|_, (_, chunk)| Arc::strong_count(chunk) > 1));
}

/// Whether surfaces of any window may not have what they should. It is said once.
pub fn finish_and_check() -> bool {
    finish();
    HAS_SPOILED.take()
}

/// The driver keeps what the queue has needed.
pub fn rest() {
    if IS_USABLE.load(Ordering::Acquire) {
        CHUNKS.take();
        bd_gpu_rest();
    }
}

pub fn draw(buffers: &mut Buffers, instances: &[Instance], passes: &[Pass<Surface>]) -> bool {
    succeeded(try_to_draw(buffers, instances, passes))
}

fn succeeded(result: Result<()>) -> bool {
    if let Err(error) = &result {
        crate::diagnostics::log!("the GPU is no longer used: {error:#}");
        IS_USABLE.store(false, Ordering::Relaxed);
    }
    result.is_ok()
}
