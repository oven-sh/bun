//! The life of a context, and what it has to do with its canvas.

use core::cell::{Cell, OnceCell, RefCell};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::rc::{self, Rc};

use bun_jsc::bindgen::{self, ClassStructure, JsHeap, JsInterface as _, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSValue, JsCell, Weak};
use bun_web::host::Level;

use super::INVALID_OPERATION;
use super::commands::{Op, text_in};
use super::stream::Stream;
use crate::abi_webgl::{Attributes, Unpacking};
use crate::api::canvas::{self, Bitmap, Recorder, flush_canvases};
use crate::api::core::{Atom, Doc, DomString, Element, EventTarget, Known, Node, atom, global_of};
use crate::api::events::{Event, EventInit, Trusted, dispatch, event_init};
use crate::api::realm::{is_program, last_client_of, queue_task};
use crate::generated_bindgen::canvas::PredefinedColorSpace;
use crate::generated_bindgen::webgl::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

const MAX_CONTEXTS: usize = 16;
const FEW_OBJECTS: u32 = 64;
const FEW_BYTES: usize = 32 << 20;
const CONTEXT_LOST: u32 = 0x9242;

#[repr(C)]
pub(crate) struct WebGLContextEvent {
    pub(crate) base: Event,
    message: DomString,
}

impl WebGLContextEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &WebGLContextEventInit<'a>,
    ) -> &'a Self {
        structure.create(
            heap,
            WebGLContextEvent {
                base: Event::base(name, event_init!(init), Trusted::No),
                message: init.status_message.into(),
            },
        )
    }

    pub(crate) fn get_status_message(&self) -> &DomString {
        &self.message
    }
}

/// Returns false if it was canceled.
fn fire<'a>(cx: Cx<'_, 'a>, canvas: JSValue, name: Known, message: &str) -> bool {
    let Some(canvas) = EventTarget::from_js(&cx.heap, canvas) else {
        return true;
    };
    let base = Event::base(
        name,
        EventInit {
            bubbles: false,
            cancelable: true,
            composed: false,
        },
        Trusted::Yes,
    );
    let event = js_WebGLContextEvent::create(
        canvas.realm(&cx.heap),
        WebGLContextEvent {
            base,
            message: message.into(),
        },
    );
    dispatch(cx, canvas, event)
}

/// What a copy of the drawing buffer is wanted for.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Readback {
    Premultiplied,
    AsDrawn,
    /// The drawing buffer is cleared.
    Transfer,
}

#[derive(Clone, Copy, PartialEq)]
enum Loss {
    None,
    Final,
    Restorable,
}

pub(crate) struct Context {
    /// It must not outlive the VM, as a thread-local does.
    handle: OnceCell<Rc<Weak<()>>>,
    stream: JsCell<Rc<Stream>>,
    attributes: Attributes,
    power_preference: WebGLPowerPreference,
    is_desynchronized: bool,
    /// What is shown.
    front: Rc<Bitmap>,
    /// The format, the width and the height of the drawing buffer.
    storage: Cell<[u32; 3]>,
    /// For the drawing buffer and for what is uploaded.
    color_spaces: [Cell<PredefinedColorSpace>; 2],
    pub(super) unpacking: Cell<Unpacking>,
    is_shown: Cell<bool>,
    /// Whether the copy is straight, if it is up to date.
    copy: Cell<Option<bool>>,
    loss: Cell<Loss>,
    pub(super) losses: Cell<u32>,
    /// While it is lost.
    errors: Cell<[u32; 2]>,
    pub(super) held: Cell<u32>,
    pub(super) held_by_id: RefCell<Vec<JSValue>>,
    /// How many objects it held, and how large they were, when it last let go of those that it does not refer to.
    needed: Cell<(u32, usize)>,
    bytes: AtomicUsize,
}

impl Drop for Context {
    fn drop(&mut self) {
        self.stream().close();
    }
}

/// Of a thread.
#[derive(Default)]
pub(crate) struct Contexts {
    /// The oldest first.
    all: RefCell<Vec<rc::Weak<Weak<()>>>>,
    is_waiting: Cell<bool>,
    ended_tasks: Cell<u32>,
}

static HAS_ANY: AtomicBool = AtomicBool::new(false);

/// `steps` can run JavaScript.
fn for_each<'a>(cx: Cx<'_, 'a>, mut steps: impl FnMut(Cx<'_, 'a>, &'a Context)) {
    let (mut at, recorder) = (0, Recorder::current());
    while let Some(context) = {
        recorder
            .webgl
            .all
            .borrow()
            .get(at)
            .map(|it| it.upgrade()?.get())
    } {
        context
            .and_then(|it| Context::from_js(&cx.heap, it))
            .inspect(|it| steps(cx, it));
        at += 1;
    }
}

unsafe extern "C" fn at_end_of_task(_: *mut core::ffi::c_void) -> bool {
    let contexts = &Recorder::current().webgl;
    contexts.ended_tasks.update(|it| it.wrapping_add(1));
    contexts.is_waiting.set(false);
    // SAFETY: this is between tasks.
    unsafe {
        JsScope::with(VirtualMachine::get().global().as_mut_ptr(), |cx| {
            for_each(cx, |cx, it| it.end_task(cx))
        })
    };
    contexts.is_waiting.get()
}

pub(super) fn wait_for_end_of_task() {
    static TAG: u8 = 0;
    if !Recorder::current().webgl.is_waiting.replace(true) {
        VirtualMachine::get()
            .event_loop()
            .deferred_tasks
            .post_task(Some(NonNull::from(&TAG).cast()), at_end_of_task);
    }
}

/// When the rendering of the document is updated.
pub(crate) fn present<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) {
    if HAS_ANY.load(Ordering::Relaxed) {
        for_each(cx, |cx, it| {
            _ = it
                .unshown_element(&cx.heap)
                .filter(|it| it.doc() == doc)
                .inspect(|_| it.show())
        });
    }
}

/// Before a picture of the page is taken.
pub(crate) fn present_all(cx: Cx<'_, '_>) {
    if HAS_ANY.load(Ordering::Relaxed) {
        for_each(cx, |cx, it| {
            _ = it
                .element(&cx.heap)
                .filter(|it| it.is_connected())
                .inspect(|_| it.show_now())
        });
    }
}

fn open(heap: &JsHeap<'_>, attributes: Attributes) -> Option<Stream> {
    last_client_of(heap)
        .map_or_else(|| is_program(global_of(heap)), |it| it.has_webgl())
        .then(|| Stream::open(&attributes))
        .flatten()
}

impl Context {
    /// `None` if there is no WebGL.
    pub(crate) fn create<'a>(
        cx: Cx<'_, 'a>,
        canvas: JSValue,
        is_webgl2: bool,
        size: [u32; 2],
        options: JSValue,
    ) -> bindgen::Result<'a, Option<&'a Context>> {
        let given = WebGLContextAttributes::from_js(cx.global(), options)?;
        let attributes = Attributes {
            is_webgl2,
            alpha: given.alpha,
            depth: given.depth,
            stencil: given.stencil,
            antialias: given.antialias,
            premultiplied_alpha: given.premultiplied_alpha,
            preserve_drawing_buffer: given.preserve_drawing_buffer,
            fail_if_major_performance_caveat: given.fail_if_major_performance_caveat,
        };
        let Some(stream) = open(&cx.heap, attributes) else {
            fire(
                cx,
                canvas,
                atom!("webglcontextcreationerror"),
                "WebGL is not available.",
            );
            return Ok(None);
        };
        let context = Context {
            handle: OnceCell::new(),
            stream: JsCell::new(Rc::new(stream)),
            attributes,
            power_preference: given.power_preference,
            is_desynchronized: given.desynchronized,
            front: Bitmap::new([0; 2], !given.alpha, true, PredefinedColorSpace::Srgb),
            storage: Cell::default(),
            color_spaces: [PredefinedColorSpace::Srgb; 2].map(Cell::new),
            unpacking: Cell::default(),
            is_shown: false.into(),
            copy: None.into(),
            loss: Loss::None.into(),
            losses: 0.into(),
            errors: Cell::default(),
            held: 0.into(),
            held_by_id: RefCell::default(),
            needed: Cell::default(),
            bytes: 0.into(),
        };
        let realm =
            EventTarget::from_js(&cx.heap, canvas).map_or(&cx.heap, |it| it.realm(&cx.heap));
        let context = if is_webgl2 {
            js_WebGL2RenderingContext::CLASS.widen()
        } else {
            js_WebGLRenderingContext::CLASS.widen()
        }
        .create(realm, context);
        js_WebGL::set_canvas(context, canvas);
        context.enlist(&cx.heap);
        context.resize(size);
        Ok(Some(context))
    }

    fn enlist(&self, heap: &JsHeap<'_>) {
        let handle = self
            .handle
            .get_or_init(|| Rc::new(Weak::create_passive(self.to_js(), global_of(heap))));
        let find = |it: &rc::Weak<Weak<()>>| Context::from_js(heap, it.upgrade()?.get()?);
        let recorder = Recorder::current();
        let mut all = recorder.webgl.all.borrow_mut();
        all.retain(|it| find(it).is_some_and(|it| !it.is_lost() && !core::ptr::eq(it, self)));
        all.push(Rc::downgrade(handle));
        let oldest = find(&all[0]).filter(|_| all.len() > MAX_CONTEXTS);
        drop(all);
        oldest.inspect(|it| it.lose(heap, false));
        HAS_ANY.store(true, Ordering::Relaxed);
    }

    pub(crate) fn set_backing(&self, backing: &canvas::Context) {
        js_WebGL::set_backing(self, Some(backing));
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.bytes.load(Ordering::Relaxed)
    }

    #[inline(always)]
    pub(super) fn stream(&self) -> &Stream {
        self.stream.get()
    }

    pub(super) fn shared_stream(&self) -> Rc<Stream> {
        Rc::clone(self.stream.get())
    }

    #[inline(always)]
    pub(super) fn drawing(&self) -> &Stream {
        self.is_shown.set(false);
        self.copy.set(None);
        self.stream()
    }

    #[inline(always)]
    pub(super) fn context(&self) -> &Context {
        self
    }

    #[inline(always)]
    pub(super) fn target(&self) -> Option<&Context> {
        Some(self)
    }

    pub(super) fn is_webgl2(&self) -> bool {
        self.attributes.is_webgl2
    }

    pub(super) fn is_lost(&self) -> bool {
        self.loss.get() != Loss::None
    }

    pub(super) fn task(&self) -> u32 {
        wait_for_end_of_task();
        Recorder::current().webgl.ended_tasks.get().wrapping_add(1)
    }

    #[cold]
    pub(super) fn fail(&self, error: u32, message: &str) {
        self.stream()
            .send_with(&[Op::Fail as u32, error], &[message.as_bytes()]);
    }

    fn canvas(&self) -> JSValue {
        js_WebGL::canvas(self).unwrap_or(JSValue::UNDEFINED)
    }

    fn element<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Element> {
        Node::from_js(heap, self.canvas())?.as_element()
    }

    fn unshown_element<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Element> {
        self.element(heap)
            .filter(|it| !self.is_shown.get() && it.is_connected())
    }

    fn store(&self, format: u32, [width, height]: [u32; 2]) {
        self.drawing()
            .send([Op::DrawingBufferStorage as u32, format, width, height]);
        self.stream().answer(|it| {
            it.get(1..)
                .and_then(|it| it.try_into().ok())
                .map(|it| self.storage.set(it))
        });
    }

    pub(crate) fn resize(&self, size: [u32; 2]) {
        if size.map(|it| it.max(1)) != self.size() {
            self.store(0, size);
        }
    }

    fn size(&self) -> [u32; 2] {
        [self.storage.get()[1], self.storage.get()[2]]
    }

    fn is_wide(&self) -> bool {
        self.color_spaces[0].get() == PredefinedColorSpace::DisplayP3
    }

    pub(crate) fn front(&self) -> &Rc<Bitmap> {
        &self.front
    }

    pub(crate) fn show_now(&self) {
        self.show();
        self.stream().show(self.front.id(), true);
    }

    fn show(&self) {
        if !self.is_shown.replace(true) {
            self.copy.set(None);
            self.front
                .will_be_replaced(self.size(), false, self.is_wide());
            flush_canvases();
            self.stream().send([Op::Present as u32, self.front.id()]);
            self.stream().show(self.front.id(), false);
        }
    }

    /// The canvas was inserted, or something was drawn.
    pub(crate) fn show_soon<'a>(&self, cx: Cx<'_, 'a>) {
        match self.unshown_element(&cx.heap) {
            Some(element) => element.doc().invalidate(cx),
            None if self.is_shown.get() => {}
            None => js_WebGL::backing(self)
                .into_iter()
                .for_each(canvas::Context::present_now),
        }
    }

    pub(crate) fn copy_to(&self, bitmap: &Bitmap, wanted: Readback) {
        let (discards, is_straight) = (
            wanted == Readback::Transfer,
            wanted == Readback::AsDrawn && !self.attributes.premultiplied_alpha,
        );
        if self.copy.replace((!discards).then_some(is_straight)) != Some(is_straight) || discards {
            bitmap.will_be_replaced(self.size(), is_straight, self.is_wide());
            flush_canvases();
            self.stream()
                .send([Op::ReadBack as u32, discards.into(), is_straight.into()]);
            self.stream().show(bitmap.id(), true);
        }
    }

    fn end_task<'a>(&self, cx: Cx<'_, 'a>) {
        let stream = self.shared_stream();
        if !stream.was_used.get() || self.notice_loss(&cx.heap) {
            return;
        }
        let Some((bytes, has_messages)) = stream.with_progress(|it| {
            (
                it.bytes.load(Ordering::Relaxed),
                it.has_messages.load(Ordering::Relaxed),
            )
        }) else {
            return;
        };
        let released = stream.released.take();
        released
            .iter()
            .for_each(|it| stream.send([Op::Release as u32, *it]));
        stream.free(released);
        let (objects, size) = self.needed.get();
        if self.held.get() > objects + objects.max(FEW_OBJECTS)
            || bytes > size + (size / 2).max(FEW_BYTES)
        {
            stream.send([Op::ListReferenced as u32]);
            stream.answer(|it| it.get(1..).map(|it| self.hold_only(it)));
            self.needed.set((self.held.get(), bytes));
        }
        if has_messages {
            self.log(&cx.heap);
        }
        self.show_soon(cx);
        stream.send([Op::EndTask as u32]);
        stream.rest();
        self.needed
            .set((self.needed.get().0, self.needed.get().1.min(bytes)));
        let before = self.bytes.swap(bytes, Ordering::Relaxed);
        cx.heap
            .report_extra_memory(self.as_object(&cx.heap), bytes.saturating_sub(before));
    }

    #[cold]
    fn log(&self, heap: &JsHeap<'_>) {
        self.stream().send([Op::TakeMessages as u32]);
        let text = self
            .stream()
            .answer(|it| crate::values::text(text_in(it.get(1..).unwrap_or_default())).to_owned());
        if let Some(window) = self.element(heap).and_then(|it| it.doc().window()) {
            bun_core::strings::split(text.as_bytes(), b"\n").for_each(|it| {
                window.host().console(
                    Level::Warning,
                    crate::values::text(it).into(),
                    0,
                    String::new(),
                )
            });
        }
    }

    fn notice_loss(&self, heap: &JsHeap<'_>) -> bool {
        if self.stream().is_broken() {
            self.lose(heap, true);
        }
        self.is_lost()
    }

    /// https://registry.khronos.org/webgl/specs/latest/1.0/#CONTEXT_LOST
    fn lose(&self, heap: &JsHeap<'_>, restores: bool) {
        self.stream().close();
        self.loss.set(Loss::Final);
        self.losses.update(|it| it + 1);
        self.errors.set([CONTEXT_LOST, 0]);
        self.storage.update(|it| [it[0], 0, 0]);
        self.bytes.store(0, Ordering::Relaxed);
        self.hold_only(&[]);
        self.forget_extensions(heap);
        self.front.erase();
        queue_task(self.realm(heap), [self.to_js()], move |cx, [this]| {
            let Some(this) = Context::from_js(&cx.heap, this.to_js()) else {
                return;
            };
            if !fire(cx, this.canvas(), atom!("webglcontextlost"), "") {
                this.loss.set(Loss::Restorable);
                if restores {
                    this.restore_on_request(&cx.heap);
                }
            }
        });
    }

    pub(super) fn lose_on_request(&self, heap: &JsHeap<'_>) {
        if self.is_lost() {
            self.errors.update(|it| [it[0], INVALID_OPERATION])
        } else {
            self.lose(heap, false)
        }
    }

    pub(super) fn restore_on_request(&self, heap: &JsHeap<'_>) {
        match self.loss.get() {
            Loss::None => self.fail(INVALID_OPERATION, "restoreContext: the context is alive"),
            Loss::Final => self.errors.update(|it| [it[0], INVALID_OPERATION]),
            Loss::Restorable => queue_task(self.realm(heap), [self.to_js()], |cx, [this]| {
                _ = Context::from_js(&cx.heap, this.to_js()).map(|it| it.restore(cx))
            }),
        }
    }

    fn restore<'a>(&'a self, cx: Cx<'_, 'a>) {
        let Some(stream) = self
            .is_lost()
            .then(|| open(self.realm(&cx.heap), self.attributes))
            .flatten()
        else {
            return;
        };
        self.stream.set(Rc::new(stream));
        self.loss.set(Loss::None);
        self.unpacking.take();
        self.needed.take();
        self.enlist(&cx.heap);
        self.resize(js_WebGL::backing(self).map_or([0; 2], |it| canvas::canvas_size(&cx.heap, it)));
        self.send_color_spaces();
        fire(cx, self.canvas(), atom!("webglcontextrestored"), "");
    }

    fn send_color_spaces(&self) {
        let [drawing, unpack] = self
            .color_spaces
            .each_ref()
            .map(|it| u32::from(it.get() != PredefinedColorSpace::Srgb));
        self.drawing()
            .send([Op::SetColorSpaces as u32, drawing, unpack]);
    }
}

impl WebGLRenderingContextBase {
    pub(crate) fn get_drawing_buffer_format(&self) -> u32 {
        self.storage.get()[0]
    }

    pub(crate) fn get_drawing_buffer_width(&self) -> u32 {
        self.storage.get()[1]
    }

    pub(crate) fn get_drawing_buffer_height(&self) -> u32 {
        self.storage.get()[2]
    }

    pub(crate) fn get_drawing_buffer_color_space(&self) -> PredefinedColorSpace {
        self.color_spaces[0].get()
    }

    pub(crate) fn set_drawing_buffer_color_space(&self, value: PredefinedColorSpace) {
        if self.color_spaces[0].replace(value) != value {
            self.send_color_spaces();
            self.store(0, self.size());
        }
    }

    pub(crate) fn get_unpack_color_space(&self) -> PredefinedColorSpace {
        self.color_spaces[1].get()
    }

    pub(crate) fn set_unpack_color_space(&self, value: PredefinedColorSpace) {
        self.color_spaces[1].set(value);
        self.send_color_spaces();
    }

    pub(crate) fn drawing_buffer_storage(&self, format: u32, width: u32, height: u32) {
        self.store(format.max(1), [width, height]);
    }

    pub(crate) fn get_context_attributes(
        &self,
        heap: &JsHeap<'_>,
    ) -> Option<WebGLActualAttributes> {
        let Attributes {
            alpha,
            depth,
            stencil,
            antialias,
            premultiplied_alpha,
            preserve_drawing_buffer,
            fail_if_major_performance_caveat,
            ..
        } = self.attributes;
        let (power_preference, desynchronized) = (self.power_preference, self.is_desynchronized);
        let attributes = WebGLActualAttributes {
            alpha,
            antialias,
            depth,
            desynchronized,
            fail_if_major_performance_caveat,
            power_preference,
            premultiplied_alpha,
            preserve_drawing_buffer,
            stencil,
        };
        (!self.notice_loss(heap)).then_some(attributes)
    }

    pub(crate) fn get_error(&self, heap: &JsHeap<'_>) -> u32 {
        self.stream().send([Op::GetError as u32]);
        let error = self.stream().answer(|it| it.get(1).copied().unwrap_or(0));
        if !self.notice_loss(heap) {
            return error;
        }
        let [first, second] = self.errors.get();
        self.errors
            .set(if first != 0 { [0, second] } else { [0; 2] });
        if first != 0 { first } else { second }
    }

    pub(crate) fn is_context_lost(&self, heap: &JsHeap<'_>) -> bool {
        self.notice_loss(heap)
    }
}
