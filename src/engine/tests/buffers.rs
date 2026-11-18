use core::ffi::c_void;
use core::sync::atomic::{AtomicUsize, Ordering};
use core::time::Duration;
use std::sync::Arc;

use bun_engine_standalone as _;
use bun_engine_text::{StringRef, names};
use bun_engine_vm::heap::{HeapKind, Scope};
use bun_engine_vm::*;

static HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks::DEFAULT,
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| Ok(cx.global()),
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};

fn with_realm<R>(body: impl FnOnce(&mut Cx) -> R) -> R {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    unsafe { body(Cx::from_global(GlobalObject::create(vm.get(), &HOOKS))) }
}

fn spawn<R: Send + 'static>(
    body: impl FnOnce() -> R + Send + 'static,
) -> std::thread::JoinHandle<R> {
    let builder = std::thread::Builder::new().stack_size(4 << 20);
    builder.spawn(body).unwrap()
}

unsafe extern "C" fn count_call(_: *mut c_void, calls: *mut c_void) {
    // SAFETY: what `external` passes.
    unsafe { &*calls.cast::<AtomicUsize>() }.fetch_add(1, Ordering::SeqCst);
}

/// Of memory that is never freed. Letting go of it is counted.
fn external(bytes: &'static mut [u8], calls: &'static AtomicUsize) -> ArrayBufferContents {
    let context = core::ptr::from_ref(calls).cast_mut().cast();
    // SAFETY: both live for ever.
    unsafe {
        ArrayBufferContents::external(bytes.as_mut_ptr(), bytes.len(), Some(count_call), context)
    }
}

fn view<T: Element>(
    cx: &Cx,
    buffer: &ArrayBuffer,
    byte_offset: usize,
    length: Option<usize>,
) -> Gc<TypedArray<T>> {
    let is_resizable = buffer.is_resizable_or_growable();
    let shape = cx.global().typed_array_shape(cx, T::TYPE, is_resizable);
    let view = JsArrayBufferView::create_on_buffer(cx, shape, buffer, byte_offset, length);
    view.unwrap().cast()
}

fn zeros<T: Element>(cx: &Cx, length: usize) -> Gc<TypedArray<T>> {
    let shape = cx.global().typed_array_shape(cx, T::TYPE, false);
    TypedArray::create(cx, shape, length).unwrap()
}

fn contents_of<T: Element>(cx: &mut Cx, array: &TypedArray<T>) -> Vec<T> {
    array.elements(&cx.no_gc()).try_to_vec().unwrap()
}

/// Leaves nothing of what `make` has made on the stack.
fn out_of_sight(cx: &mut Cx, make: &mut dyn FnMut(&mut Cx)) {
    #[inline(never)]
    fn overwrite_stack() {
        core::hint::black_box([0u8; 1 << 15]);
    }
    core::hint::black_box(make)(cx);
    overwrite_stack();
}

#[test]
fn external_memory_is_released_once_when_the_last_cell_dies() {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    with_realm(|cx| {
        let holder = cx.new_object();
        out_of_sight(cx, &mut |cx| {
            let buffer = ArrayBufferRef::new(external(vec![7; 64].leak(), &CALLS));
            for offset in 0..32 {
                view::<u8>(cx, &buffer, offset, None);
            }
            let kept = view::<u8>(cx, &buffer, 8, Some(4));
            holder.put_direct(cx, names::value, kept.into(), Attributes::NONE);
        });
        for scope in [Scope::Eden, Scope::Full, Scope::Eden] {
            cx.heap.collect_and_sweep(Some(scope));
            assert_eq!(CALLS.load(Ordering::SeqCst), 0);
        }
        assert!(cx.heap.array_buffer_size() >= 64);
        out_of_sight(cx, &mut |cx| {
            let kept = holder.get_direct(names::value).unwrap();
            assert_eq!(contents_of(cx, &kept.cast::<JsUint8Array>()), [7; 4]);
            holder.put_direct(cx, names::value, Value::NULL, Attributes::NONE);
        });
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(CALLS.load(Ordering::SeqCst), 1);
        assert_eq!(cx.heap.array_buffer_size(), 0);
    });
    assert_eq!(CALLS.load(Ordering::SeqCst), 1);
}

#[test]
fn what_is_alive_at_the_end_is_released_unless_it_is_held() {
    static ONLY_IN_HEAP: AtomicUsize = AtomicUsize::new(0);
    static HELD: AtomicUsize = AtomicUsize::new(0);
    let held = ArrayBufferRef::new(external(vec![0; 8].leak(), &HELD));
    with_realm(|cx| {
        let buffer = ArrayBufferRef::new(external(vec![0; 8].leak(), &ONLY_IN_HEAP));
        view::<u8>(cx, &buffer, 0, None);
        JsArrayBuffer::wrap(cx, &cx.global(), &held);
        zeros::<f64>(cx, 5000);
    });
    assert_eq!(ONLY_IN_HEAP.load(Ordering::SeqCst), 1);
    assert_eq!(HELD.load(Ordering::SeqCst), 0);
    with_realm(|cx| assert_eq!(view::<u8>(cx, &held, 0, None).length(), 8));
    drop(held);
    assert_eq!(HELD.load(Ordering::SeqCst), 1);
}

#[test]
fn an_old_view_keeps_a_new_wrapper() {
    with_realm(|cx| {
        for length in [0, 3, 1000, 1001] {
            let array = zeros::<u16>(cx, length);
            array.elements(&cx.no_gc()).fill(9);
            cx.heap.collect_and_sweep(Some(Scope::Full));
            out_of_sight(cx, &mut |cx| {
                let buffer = array.buffer(cx).unwrap();
                let young = view::<u16>(cx, &buffer, 0, None);
                let wrapper = young.js_buffer(cx).unwrap();
                wrapper.put_direct(cx, names::value, Value::TRUE, Attributes::NONE);
            });
            for scope in [Scope::Eden, Scope::Eden, Scope::Full] {
                cx.heap.collect_and_sweep(Some(scope));
                out_of_sight(cx, &mut |cx| {
                    let wrapper = array.js_buffer(cx).unwrap();
                    assert_eq!(wrapper.get_direct(names::value), Some(Value::TRUE));
                });
            }
            assert_eq!(contents_of(cx, &array), vec![9; length]);
        }
    });
}

#[test]
fn a_second_wrapper_keeps_the_buffer_too() {
    with_realm(|cx| {
        let shape = cx.array_buffer_shape();
        let contents = ArrayBufferContents::try_from_slice(&[1, 2, 3]).unwrap();
        let first = JsArrayBuffer::from_contents(cx, shape, contents).unwrap();
        out_of_sight(cx, &mut |cx| {
            JsArrayBuffer::create(cx, shape, &first.buffer());
        });
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert!(first.buffer().wrapper(cx).is_none());
        assert!(first.bytes(&cx.no_gc()).iter().eq([1, 2, 3]));
    });
}

#[test]
fn detaching_empties_all_views() {
    with_realm(|cx| {
        let buffer = ArrayBufferRef::new(ArrayBufferContents::try_zeroed(16).unwrap());
        let (bytes, words) = (
            view::<u8>(cx, &buffer, 1, None),
            view::<u32>(cx, &buffer, 4, Some(2)),
        );
        words.set(cx, 0, 0x0403_0201);
        let size = cx.heap.array_buffer_size();
        let mut moved = buffer.transfer(cx).unwrap();
        assert_eq!(moved.as_mut_slice().unwrap()[4..8], [1, 2, 3, 4]);
        assert_eq!(cx.heap.array_buffer_size(), size - 16);
        assert!(!cx.array_buffer_detach_watchpoints().is_still_valid());
        assert!(!buffer.detach_watchpoints().is_still_valid());
        for view in [bytes.upcast::<JsTypedArray>(), words.upcast()] {
            assert!(view.is_detached() && view.is_out_of_bounds());
            assert_eq!((view.length(), view.byte_offset()), (0, 0));
            assert_eq!(view.get_element(cx, 0), None);
        }
        assert!(buffer.transfer(cx).is_none());
    });
}

#[test]
fn a_pinned_buffer_is_copied_instead_of_detached() {
    with_realm(|cx| {
        for length in [10, 2000] {
            let array = zeros::<u8>(cx, length);
            array.set(cx, 1, 5);
            let buffer = array.buffer(cx).unwrap();
            // SAFETY: nothing borrows the elements.
            unsafe { array.pin(cx) }.unwrap();
            let vector = array.vector();
            let mut copy = buffer.transfer(cx).unwrap();
            assert_eq!(copy.as_mut_slice().unwrap()[1], 5);
            let shorter = buffer.transfer_to_fixed_length(cx, 2).unwrap();
            assert_eq!(shorter.byte_length(), 2);
            assert_eq!((array.vector(), array.length()), (vector, length));
            array.unpin();
            assert_eq!(buffer.transfer(cx).unwrap().data(), vector);
            assert!(array.is_detached());
        }
    });
}

#[test]
fn a_view_that_was_pinned_without_a_buffer_keeps_its_bytes_when_it_is_detached() {
    const LENGTH: usize = 64 << 20;
    with_realm(|cx| {
        for new_length in [0, 2, LENGTH, LENGTH + 1] {
            let array = zeros::<u8>(cx, LENGTH);
            array.set(cx, LENGTH - 1, 5);
            // SAFETY: nothing borrows the elements.
            (0..2).for_each(|_| unsafe { array.pin(cx) }.unwrap());
            assert!(!array.has_buffer());
            let (vector, buffer) = (array.vector(), array.buffer(cx).unwrap());
            buffer.pin();
            array.unpin();
            assert!(!buffer.is_detachable());
            buffer.unpin();
            let moved = buffer.transfer_to_fixed_length(cx, new_length).unwrap();
            assert!(array.is_detached());
            assert_eq!(moved.byte_length(), new_length);
            assert_eq!(moved.data() == vector, new_length == LENGTH);
            drop((moved, buffer.detach(cx)));
            // SAFETY: what a pin promises.
            assert_eq!(unsafe { vector.add(LENGTH - 1).read_volatile() }, 5);
            array.unpin();
        }
    });
}

#[test]
fn views_follow_a_resizable_buffer() {
    const MIB: usize = 1 << 20;
    with_realm(|cx| {
        for max in [64, 8 * MIB] {
            let buffer = ArrayBufferRef::new(ArrayBufferContents::try_resizable(max, max).unwrap());
            let tracking = view::<u16>(cx, &buffer, 8, None);
            let fixed = view::<u16>(cx, &buffer, 8, Some(8));
            buffer.bytes(&cx.no_gc()).fill(0xff);
            for (length, of_tracking, of_fixed) in [
                (24, Some(8), Some(8)),
                (23, Some(7), None),
                (8, Some(0), None),
                (7, None, None),
                (0, None, None),
            ] {
                buffer.resize(cx, length).unwrap();
                assert!(tracking.known_length() <= of_tracking.unwrap_or(0));
                assert!(fixed.known_length() <= of_fixed.unwrap_or(0));
                assert_eq!(tracking.checked_length(), of_tracking);
                assert_eq!(fixed.checked_length(), of_fixed);
                assert_eq!(tracking.known_length(), of_tracking.unwrap_or(0));
                cx.heap.collect_and_sweep(None);
            }
            buffer.resize(cx, max).unwrap();
            assert_eq!(tracking.get((max - 8) / 2 - 1), Some(0));
            assert_eq!(fixed.get(7), Some(0));
            assert_eq!(buffer.bytes(&cx.no_gc()).index_of(0xff), None);
            assert_eq!(buffer.resize(cx, max + 1), Err(ResizeError::InvalidLength));
        }
    });
}

#[test]
fn a_pinned_buffer_that_shrinks_keeps_its_pages() {
    const LENGTH: usize = 4 << 20;
    with_realm(|cx| {
        let contents = ArrayBufferContents::try_resizable(LENGTH, LENGTH).unwrap();
        let buffer = ArrayBufferRef::new(contents);
        buffer.pin();
        buffer.resize(cx, 0).unwrap();
        // SAFETY: what a pin promises.
        unsafe { buffer.data().add(LENGTH - 1).write(1) };
        buffer.unpin();
        buffer.resize(cx, LENGTH).unwrap();
        assert_eq!(buffer.bytes(&cx.no_gc()).at(LENGTH - 1), 0);
    });
}

#[test]
fn what_a_memory_leaves_behind_stays_until_the_last_pin_is_gone() {
    static RELEASED: AtomicUsize = AtomicUsize::new(0);
    let pages = |length| external(vec![0; length].leak(), &RELEASED).with_max_byte_length(64);
    with_realm(|cx| {
        let buffer = ArrayBufferRef::new(pages(8));
        buffer.make_wasm_memory();
        // SAFETY: nothing borrows the bytes.
        let grow_to = |length| unsafe { buffer.did_grow_wasm_memory(cx, pages(length)) };
        grow_to(16);
        assert_eq!(RELEASED.load(Ordering::SeqCst), 1);
        buffer.pin();
        grow_to(32);
        buffer.pin();
        drop(buffer.detach(cx));
        buffer.unpin();
        assert_eq!(RELEASED.load(Ordering::SeqCst), 1);
        buffer.unpin();
        assert_eq!(RELEASED.load(Ordering::SeqCst), 3);
    });
}

#[test]
fn the_copy_of_a_view_fits_the_largest_size_of_its_buffer() {
    with_realm(|cx| {
        let buffer = ArrayBufferRef::new(ArrayBufferContents::try_resizable(4, 16).unwrap());
        let shape = cx.global().typed_array_shape(cx, ElementType::Int32, true);
        let copy = JsArrayBufferView::recreate_on_buffer(cx, shape, &buffer, 8, Some(2)).unwrap();
        assert_eq!((copy.known_length(), copy.checked_length()), (0, None));
        assert_eq!(
            (copy.declared_byte_offset(), copy.declared_length()),
            (8, Some(2))
        );
        buffer.resize(cx, 16).unwrap();
        assert_eq!(copy.checked_length(), Some(2));
        for (offset, length) in [(8, Some(3)), (20, None), (2, Some(1))] {
            let view = JsArrayBufferView::recreate_on_buffer(cx, shape, &buffer, offset, length);
            cx.catch(view.unwrap_err()).unwrap();
        }
    });
}

#[test]
fn memory_need_not_be_aligned() {
    static CALLS: AtomicUsize = AtomicUsize::new(0);
    with_realm(|cx| {
        let bytes = &mut vec![0u8; 8 * 40 + 8].leak()[..];
        let skip = bytes.as_ptr().align_offset(8) + 1;
        let buffer = ArrayBufferRef::new(external(&mut bytes[skip % 8..][..8 * 40], &CALLS));
        let (integers, floats) = (
            view::<u64>(cx, &buffer, 0, None),
            view::<f64>(cx, &buffer, 0, None),
        );
        let no_gc = cx.no_gc();
        let (integers, floats) = (integers.elements(&no_gc), floats.elements(&no_gc));
        assert!(!integers.is_aligned());
        integers.fill_from(0..);
        integers.reverse();
        assert_eq!(integers.index_of(39), Some(0));
        assert_eq!(integers.last_index_of(0), Some(39));
        assert_eq!(integers.atomic_modify(39, AtomicOperation::Sub, 1), 0);
        assert_eq!(integers.atomic_compare_exchange(39, u64::MAX, 3), u64::MAX);
        assert_eq!(integers.atomic_compare_exchange(39, 0, 4), 3);
        integers.atomic_store(0, 8);
        assert_eq!((integers.atomic_load(0), integers.atomic_load(39)), (8, 3));
        floats.fill(1.5);
        assert!(!floats.contains(f64::NAN));
        floats.set(20, -0.0);
        floats.set(30, -f64::NAN);
        assert_eq!(floats.index_of(0.0), Some(20));
        assert!(floats.contains(f64::NAN));
    });
}

fn check_searches<T: NumberElement>() {
    for length in 0..150 {
        let mut elements = vec![T::from_int32(1); length];
        let slice = BufferSlice::from(&mut *elements);
        assert_eq!(slice.index_of(T::from_int32(2)), None);
        assert_eq!(slice.last_index_of(T::from_int32(2)), None);
        for first in 0..length {
            let last = (first + first % 7).min(length - 1);
            slice.set(first, T::from_int32(2));
            slice.set(last, T::from_int32(2));
            assert_eq!(slice.index_of(T::from_int32(2)), Some(first));
            assert_eq!(slice.last_index_of(T::from_int32(2)), Some(last));
            if T::TYPE.is_float() {
                assert!(!slice.contains(T::from_double(f64::NAN)));
                slice.set(first, T::from_double(f64::NEG_INFINITY));
                assert!(!slice.contains(T::from_double(f64::NAN)));
                slice.set(first, T::from_double(f64::NAN));
                assert!(slice.contains(T::from_double(f64::NAN)));
            }
            slice.fill(T::from_int32(1));
        }
    }
}

#[test]
fn searches_find_elements_anywhere() {
    for element_type in ElementType::ALL {
        with_element_type!(element_type, T => check_searches::<T>(), bigint => {});
    }
}

#[test]
fn copies_between_views_that_overlap() {
    with_realm(|cx| {
        let buffer = ArrayBufferRef::new(ArrayBufferContents::try_zeroed(64).unwrap());
        let bytes = view::<u8>(cx, &buffer, 0, None);
        let expected: Vec<u8> = (1..=8).collect();
        for from in (0..32).step_by(4) {
            for to in (0..32).step_by(4) {
                let narrow = view::<u8>(cx, &buffer, from, Some(8));
                let wide = view::<u32>(cx, &buffer, to, Some(8));
                narrow.elements(&cx.no_gc()).copy_from_slice(&expected);
                wide.set_from_whole_typed_array(cx, 0, &narrow).unwrap();
                assert!(contents_of(cx, &wide).into_iter().eq(1..=8));
                narrow.set_from_whole_typed_array(cx, 0, &wide).unwrap();
                assert_eq!(contents_of(cx, &narrow), expected);
            }
        }
        for distance in 0..20 {
            bytes.elements(&cx.no_gc()).fill_from(0..);
            let mut model = contents_of(cx, &bytes);
            for index in 0..40 {
                model[distance + index] = model[index];
            }
            (bytes.set_from_typed_array(cx, distance, &bytes, 0..40, CopyOrder::Ascending))
                .unwrap();
            assert_eq!(contents_of(cx, &bytes), model);
        }
    });
}

fn shared_words(cx: &Cx, contents: &Arc<SharedArrayBufferContents>) -> Gc<TypedArray<i32>> {
    let contents = ArrayBufferContents::shared(Arc::clone(contents), false);
    view(cx, &ArrayBufferRef::new(contents), 0, None)
}

fn new_shared(byte_length: usize, max: usize) -> Arc<SharedArrayBufferContents> {
    set_options(Options::default());
    let contents = ArrayBufferContents::try_resizable(byte_length, max).unwrap();
    Arc::clone(contents.into_shared().shared_contents().unwrap())
}

#[test]
fn another_thread_grows_shared_memory() {
    let shared = new_shared(8, 1 << 20);
    with_realm(|cx| {
        let words = shared_words(cx, &shared);
        assert!(words.borrow_bytes(cx).is_none());
        let other = Arc::clone(&shared);
        let grow = move |cx: &mut Cx| {
            let words = shared_words(cx, &other);
            let buffer = words.buffer(cx).unwrap();
            buffer.grow(cx, 1 << 20).unwrap();
            assert_eq!(buffer.grow(cx, 8), Err(ResizeError::InvalidLength));
            words.set(cx, (1 << 18) - 1, 5);
        };
        spawn(|| with_realm(grow)).join().unwrap();
        assert_eq!(words.known_length(), 2);
        assert_eq!(words.get((1 << 18) - 1), Some(5));
        assert_eq!(words.length(), 1 << 18);
    });
}

fn wait_until_waiting(address: usize, count: usize) {
    while waiter_count(Some(address)) != count {
        std::thread::yield_now();
    }
}

#[test]
fn waiters_wake_in_the_order_in_which_they_came() {
    let shared = new_shared(8, 8);
    let address = shared.data().addr();
    let mut threads = Vec::new();
    for count in 1..=3 {
        let shared = Arc::clone(&shared);
        let wait = move |cx: &mut Cx| shared_words(cx, &shared).wait(cx, 0, 0, None).unwrap();
        threads.push(spawn(|| with_realm(wait)));
        wait_until_waiting(address, count);
    }
    assert_eq!(notify_at_address(address + 4, u32::MAX), 0);
    for thread in threads {
        assert_eq!(notify_at_address(address, 1), 1);
        assert_eq!(thread.join().unwrap(), WaitResult::Ok);
    }
    with_realm(|cx| {
        let words = shared_words(cx, &shared);
        let timeout = Some(Duration::from_millis(1));
        assert_eq!(words.wait(cx, 0, 1, None).unwrap(), WaitResult::NotEqual);
        assert_eq!(words.wait(cx, 0, 0, timeout).unwrap(), WaitResult::TimedOut);
    });
    assert_eq!(waiter_count(Some(address)), 0);
}

#[test]
fn termination_ends_a_wait() {
    let shared = new_shared(4, 4);
    let address = shared.data().addr();
    with_realm(|cx| {
        let traps = core::ptr::from_ref(cx.traps()).expose_provenance();
        let terminator = spawn(move || {
            wait_until_waiting(address, 1);
            // SAFETY: the `Vm` waits for this thread, and any thread may use its traps.
            unsafe { &*core::ptr::with_exposed_provenance::<Traps>(traps) }.request_termination();
        });
        assert!(shared_words(cx, &shared).wait(cx, 0, 0, None).is_err());
        assert!(cx.has_pending_termination_exception());
        terminator.join().unwrap();
    });
    assert_eq!(waiter_count(Some(address)), 0);
}
