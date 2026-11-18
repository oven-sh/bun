//! What all the modules do with JS values. Everything is in the realm of the app.

use core::fmt::Arguments;
use core::marker::PhantomData;

use bun_jsc::bindgen::{Class, JsHeap, JsInterface, JsLocal, JsRecord, JsScope};
use bun_jsc::job::{Completion, Job, JobContext, JsAffine, JsThread};
use bun_jsc::{
    ErrorCode, JSGlobalObject, JSMap, JSPromise, JSPromiseStrong, JSString, JSValue, JsError,
    JsResult, MarkedArgumentBuffer, Strong,
};
use bun_ui::protocol::{Command, Outcome, PreferenceValue, ShellCommand, SystemCommand, Ui};
use bun_ui::value::IntoJs;
use bun_web::tasks::{self, Work};

use crate::generated_bindgen::base::{js_DesktopAppEvent, js_DesktopClosure};

pub(crate) use bun_ui::main_global as global;
pub(crate) use bun_web::tasks::Priority;

pub(crate) type Cx<'a, 'b> = &'b mut JsScope<'a>;

pub(crate) fn heap() -> &'static JsHeap<'static> {
    JsHeap::from_global(global())
}

pub(crate) fn js(value: impl IntoJs) -> JsResult<JSValue> {
    value.into_js(global())
}

macro_rules! object {
    ({}) => { bun_jsc::JSValue::create_empty_object($crate::js::global(), 0) };
    ($($members:tt)*) => { bun_ui::object!($crate::js::global(), $($members)*) };
}

/// The reference keeps the object alive while it is on the stack, and only there.
pub(crate) fn cast<T: JsInterface>(value: JSValue) -> Option<&'static T> {
    T::from_js(heap(), value)
}

/// For the struct of an object that has nothing but internal fields to change. The compiler takes what a reference
/// to an immutable struct leads to for constant, and a reference to nothing points past the object.
pub(crate) type HasFields = core::cell::Cell<u8>;

/// Keeps an object alive.
pub(crate) struct Root<T>(Strong, PhantomData<T>);

impl<T: JsInterface> Root<T> {
    pub(crate) fn new(object: &T) -> Self {
        Root(Strong::create(object.to_js(), global()), PhantomData)
    }

    /// See [`cast`].
    pub(crate) fn get(&self) -> &'static T {
        // SAFETY: it was made of a `T`.
        unsafe { T::from_js_unchecked(self.0.get()) }
    }
}

pub(crate) fn keep(value: JSValue) -> Strong {
    Strong::create(value, global())
}

pub(crate) fn same<T>(a: &T, b: &T) -> bool {
    core::ptr::eq(a, b)
}

/// The instances in an array that an object has in a field. The array keeps them alive.
pub(crate) fn instances<T: JsInterface + 'static>(
    array: JSValue,
) -> impl Iterator<Item = JsResult<&'static T>> {
    let mut index = 0;
    core::iter::from_fn(move || {
        loop {
            match element(array, index) {
                Ok(Some(value)) => {
                    index += 1;
                    if let Some(found) = cast(value) {
                        return Some(Ok(found));
                    }
                }
                Ok(None) => return None,
                Err(error) => {
                    index = u32::MAX;
                    return Some(Err(error));
                }
            }
        }
    })
}

fn element(array: JSValue, index: u32) -> JsResult<Option<JSValue>> {
    if u64::from(index) >= array.get_length(global())? {
        return Ok(None);
    }
    array.get_index(global(), index).map(Some)
}

pub(crate) fn array(values: &[JSValue]) -> JsResult<JSValue> {
    JSValue::create_array_from_slice(global(), values)
}

pub(crate) fn buffer(bytes: &[u8]) -> JsResult<JSValue> {
    bun_jsc::ArrayBuffer::create_buffer(global(), bytes)
}

/// `undefined` if there is none.
pub(crate) fn get(object: JSValue, name: &str) -> JsResult<JSValue> {
    Ok(object.get(global(), name)?.unwrap_or(JSValue::UNDEFINED))
}

pub(crate) fn text_of(value: JSValue) -> JsResult<String> {
    Ok(crate::text::string(&value.to_utf8(global())?))
}

pub(crate) fn texts_of(array: JSValue) -> JsResult<Vec<String>> {
    let mut all = Vec::new();
    if array.is_array() {
        let mut values = array.array_iterator(global())?;
        while let Some(value) = values.next()? {
            all.push(text_of(value)?);
        }
    }
    Ok(all)
}

pub(crate) fn call(function: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
    function.call(global(), JSValue::UNDEFINED, arguments)
}

pub(crate) fn invoke(object: JSValue, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
    invoke_in(global(), object, method, arguments)
}

pub(crate) fn invoke_in(
    realm: &JSGlobalObject,
    object: JSValue,
    method: &str,
    arguments: &[JSValue],
) -> JsResult<JSValue> {
    match object.get(realm, method)?.filter(|it| it.is_callable()) {
        Some(function) => function.call(realm, object, arguments),
        None => Err(realm.throw_type_error(format_args!("{method} is not a function"))),
    }
}

/// `object[key]`
pub(crate) fn get_by_value(
    realm: &JSGlobalObject,
    object: JSValue,
    key: JSValue,
) -> JsResult<JSValue> {
    bun_jsc::from_js_host_call(realm, || Bun__Desktop__get(realm, object, key))
}

/// `object.name = value`
pub(crate) fn assign(object: JSValue, name: &str, value: JSValue) -> JsResult<()> {
    let name = js(name)?;
    bun_jsc::from_js_host_call_generic(global(), || {
        Bun__Desktop__set(global(), object, name, value)
    })
}

pub(crate) fn map_in(value: JSValue) -> &'static mut JSMap {
    JSMap::opaque_mut(JSMap::from_js(value).expect("it is one").as_ptr())
}

fn realm_of_array(array: JSValue) -> JsResult<&'static crate::realm::Realm> {
    match array.is_object() {
        true => Ok(crate::realm::of(array)),
        false => Err(type_error(format_args!("Expected an array"))),
    }
}

/// They are alive as long as the array has them.
pub(crate) fn elements(array: JSValue) -> JsResult<Vec<JSValue>> {
    let realm = realm_of_array(array)?;
    (0..array.get_length(realm)? as u32)
        .map(|index| array.get_index(realm, index))
        .collect()
}

/// `[...first, ...array]`
pub(crate) fn with_elements_after<T>(
    first: &[JSValue],
    array: JSValue,
    then: impl FnOnce(&mut [JSValue]) -> JsResult<T>,
) -> JsResult<T> {
    const MOST_ARGUMENTS: u64 = 1 << 20;
    let realm = realm_of_array(array)?;
    let length = array.get_length(realm)?;
    if length > MOST_ARGUMENTS {
        return Err(realm.throw_stack_overflow());
    }
    MarkedArgumentBuffer::new(|roots| {
        let mut all = first.to_vec();
        for index in 0..length as u32 {
            all.push(array.get_index(realm, index)?);
            roots.append(all[all.len() - 1]);
        }
        let result = then(&mut all);
        first.iter().for_each(|it| it.ensure_still_alive());
        result
    })
}

pub(crate) fn with_elements<T>(
    array: JSValue,
    then: impl FnOnce(&[JSValue]) -> JsResult<T>,
) -> JsResult<T> {
    with_elements_after(&[], array, |all| then(all))
}

// ── errors ──

pub(crate) fn error(message: Arguments<'_>) -> JsError {
    global().throw(message)
}

pub(crate) fn type_error(message: Arguments<'_>) -> JsError {
    global().throw_type_error(message)
}

pub(crate) fn invalid_value(option: &str, value: &str, reason: &str) -> JsError {
    let message = format_args!("The argument '{option}' {reason}. Received '{value}'");
    global().err(ErrorCode::INVALID_ARG_VALUE, message).throw()
}

/// As Electron says it, or else as Node.js does.
pub(crate) fn unknown_value(name: &str, value: &str, reason: &str) -> JsError {
    match crate::app::is_electron() {
        true => type_error(format_args!(
            "Error processing argument at index 0, conversion failure from {value}"
        )),
        false => invalid_value(name, value, reason),
    }
}

pub(crate) fn unsupported(what: &str) -> JsError {
    error(format_args!(
        "{what} is not supported by bun:desktop/electron"
    ))
}

/// `Err` has what was thrown. A termination cannot be caught.
pub(crate) fn catch<T>(result: JsResult<T>) -> JsResult<Result<T, JSValue>> {
    match result {
        Ok(value) => Ok(Ok(value)),
        Err(JsError::Terminated) => Err(JsError::Terminated),
        Err(error) => {
            let thrown = global().take_error(error);
            if thrown.is_termination_exception() {
                return Err(JsError::Terminated);
            }
            Ok(Err(thrown))
        }
    }
}

pub(crate) fn message_of(thrown: JSValue) -> JsResult<String> {
    match thrown.is_object() {
        true => text_of(get(thrown, "message")?),
        false => text_of(thrown),
    }
}

pub(crate) fn warn(message: &str) -> JsResult<()> {
    bun_ui::warn(global(), message)
}

// ── events ──

#[derive(Default)]
#[repr(align(8))]
pub(crate) struct Event {
    is_prevented: core::cell::Cell<bool>,
}

impl Event {
    pub(crate) fn create() -> &'static Event {
        let is_prevented = core::cell::Cell::new(false);
        js_DesktopAppEvent::create(heap(), Event { is_prevented })
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        _: JsLocal<'a, bun_jsc::JSObject>,
        fields: Option<JsRecord<'a, JsLocal<'a, JSString>, JsLocal<'a>>>,
    ) -> JsResult<&'a Event> {
        let event = Event::create();
        for (name, value) in fields.into_iter().flat_map(JsRecord::iter) {
            JSValue::put_to_property_key(event.to_js(), cx.global(), name.to_js(), value.to_js())?;
        }
        Ok(event)
    }

    pub(crate) fn with(&self, name: &str, value: impl IntoJs) -> JsResult<&Event> {
        self.to_js().put(global(), name.as_bytes(), js(value)?);
        Ok(self)
    }

    pub(crate) fn get_default_prevented(&self) -> bool {
        self.is_prevented.get()
    }

    pub(crate) fn prevent_default(&self) {
        self.is_prevented.set(true);
    }
}

/// Apps replace `emit` to see all events.
pub(crate) fn emit(emitter: JSValue, name: &str, arguments: &[JSValue]) -> JsResult<()> {
    let mut all = [JSValue::UNDEFINED; 8];
    all[0] = js(name)?;
    all[1..=arguments.len()].copy_from_slice(arguments);
    invoke(emitter, "emit", &all[..=arguments.len()]).map(drop)
}

/// With an [`Event`] before `arguments`. False if a listener called `preventDefault()`.
pub(crate) fn dispatch(emitter: JSValue, name: &str, arguments: &[JSValue]) -> JsResult<bool> {
    let event = Event::create();
    let mut all = [event.to_js(); 7];
    all[1..=arguments.len()].copy_from_slice(arguments);
    emit(emitter, name, &all[..=arguments.len()])?;
    Ok(!event.get_default_prevented())
}

/// As [`dispatch`], for what has happened.
pub(crate) fn announce(emitter: JSValue, name: &str, arguments: &[JSValue]) -> JsResult<()> {
    dispatch(emitter, name, arguments).map(drop)
}

pub(crate) fn has_listeners(emitter: JSValue, name: &str) -> JsResult<bool> {
    Ok(invoke(emitter, "listenerCount", &[js(name)?])?.to_boolean())
}

/// `on`, `addListener` and `prependListener` of a module, which call `$will_listen` with the name of the event.
macro_rules! notices_listeners {
    ($module:ty, $object:expr, $will_listen:expr) => {
        notices_listeners!($module, $object, $will_listen, on: "on", add_listener: "addListener", prepend_listener: "prependListener");
    };
    ($module:ty, $object:expr, $will_listen:expr, $($name:ident: $method:literal),*) => {
        impl $module {$(
            pub(crate) fn $name<'a>(_: Cx<'a, '_>, name: JsLocal<'a>, listener: JsLocal<'a>) -> JsResult<JSValue> {
                let object: JSValue = $object;
                if name.to_js().is_string() {
                    $will_listen(&text_of(name.to_js())?)?;
                }
                let inherited = get(object.get_prototype(global())?, $method)?;
                inherited.call(global(), object, &[name.to_js(), listener.to_js()])
            }
        )*}
    };
}

// ── functions ──

type Body = dyn Fn(JSValue, &[JSValue]) -> JsResult<JSValue>;

pub(crate) struct Closure(Box<Body>, #[expect(dead_code)] HasFields);

impl Closure {
    pub(crate) fn call_instance<'a>(
        &self,
        _: Cx<'a, '_>,
        arguments: &[JsLocal<'a>],
    ) -> JsResult<JSValue> {
        let captured = js_DesktopClosure::captured(self).unwrap_or(JSValue::UNDEFINED);
        (self.0)(captured, JsLocal::to_js_slice(arguments))
    }
}

/// An instance that inherits from `Function.prototype`.
pub(crate) fn create_function<T: JsInterface>(
    realm: &JSGlobalObject,
    class: Class<T>,
    payload: T::Struct,
) -> &T {
    let heap = JsHeap::from_global(realm);
    let prototype = JsLocal::new(heap, Bun__Desktop__functionPrototype(realm)).as_any_object();
    class
        .structure_with_prototype(heap, prototype.expect("it is one"))
        .create(heap, payload)
}

/// `body` gets `captured`, which the function keeps alive, and the arguments. It is not to hold JS values itself.
pub(crate) fn function_in(
    realm: &JSGlobalObject,
    captured: JSValue,
    body: impl Fn(JSValue, &[JSValue]) -> JsResult<JSValue> + 'static,
) -> JSValue {
    let closure = create_function(
        realm,
        js_DesktopClosure::CLASS,
        Closure(Box::new(body), HasFields::default()),
    );
    js_DesktopClosure::set_captured(closure, captured);
    closure.to_js()
}

pub(crate) fn function(
    captured: JSValue,
    body: impl Fn(JSValue, &[JSValue]) -> JsResult<JSValue> + 'static,
) -> JsResult<JSValue> {
    Ok(function_in(global(), captured, body))
}

/// A [`function`] that returns nothing.
pub(crate) fn listener<T: JsInterface + 'static>(
    owner: &T,
    body: impl Fn(&'static T, &[JSValue]) -> JsResult<()> + 'static,
) -> JsResult<JSValue> {
    function(owner.to_js(), move |owner, arguments| {
        // SAFETY: what was captured.
        body(unsafe { T::from_js_unchecked(owner) }, arguments)?;
        Ok(JSValue::UNDEFINED)
    })
}

pub(crate) fn procedure(body: impl Fn(&[JSValue]) -> JsResult<()> + 'static) -> JsResult<JSValue> {
    function(JSValue::UNDEFINED, move |_, arguments| {
        body(arguments).map(|()| JSValue::UNDEFINED)
    })
}

pub(crate) fn argument(arguments: &[JSValue], index: usize) -> JSValue {
    arguments.get(index).copied().unwrap_or(JSValue::UNDEFINED)
}

pub(crate) fn queue_microtask(work: fn() -> JsResult<()>) -> JsResult<()> {
    global().queue_microtask(procedure(move |_| work())?, &[]);
    Ok(())
}

pub(crate) fn post(priority: Priority, work: impl FnOnce() -> JsResult<()> + 'static) {
    tasks::post(global(), priority, Work::Once(Box::new(|_, _| work())), &[]);
}

pub(crate) fn render_pages() {
    tasks::render(global());
    crate::contents::process::render_trusted_pages();
}

// ── promises ──

pub(crate) fn resolved(value: impl IntoJs) -> JsResult<JSValue> {
    Ok(JSPromise::resolved_promise_value(global(), js(value)?))
}

/// The resolving functions of a promise.
pub(crate) struct Deferred(JSPromiseStrong);

impl Deferred {
    pub(crate) fn new() -> Self {
        Deferred(JSPromiseStrong::init(global()))
    }

    pub(crate) fn promise(&self) -> JSValue {
        self.0.value()
    }

    /// Does nothing if it is settled.
    pub(crate) fn settle(&self, result: JsResult<JSValue>) -> JsResult<()> {
        let promise = self.0.get();
        match promise.status() {
            bun_jsc::js_promise::Status::Pending => promise.settle(global(), result),
            _ => catch(result).map(drop),
        }
    }

    pub(crate) fn resolve(&self, value: impl IntoJs) -> JsResult<()> {
        self.settle(js(value))
    }
}

impl Default for Deferred {
    fn default() -> Self {
        Self::new()
    }
}

/// `await value`
pub(crate) fn then(
    value: JSValue,
    next: impl FnOnce(Result<JSValue, JSValue>) -> JsResult<()> + 'static,
) -> JsResult<()> {
    let next = std::rc::Rc::new(core::cell::Cell::new(Some(next)));
    let reaction = |outcome: fn(JSValue) -> Result<JSValue, JSValue>| {
        let next = std::rc::Rc::clone(&next);
        procedure(move |arguments| {
            let result = next
                .take()
                .map(|next| next(outcome(argument(arguments, 0))));
            bun_ui::report(global(), result.unwrap_or(Ok(())))
        })
    };
    react(global(), value, reaction(Ok)?, reaction(Err)?)
}

/// Calls one of the functions once `value` is settled.
pub(crate) fn react(
    realm: &JSGlobalObject,
    value: JSValue,
    fulfilled: JSValue,
    rejected: JSValue,
) -> JsResult<()> {
    bun_jsc::from_js_host_call_generic(realm, || {
        Bun__Desktop__await(realm, value, fulfilled, rejected)
    })
}

struct Background<T>(PhantomData<T>);
struct Next<T>(Box<dyn FnOnce(T) -> JsResult<()>>);
// SAFETY: it is called and dropped on the JS thread.
unsafe impl<T> JsAffine for Next<T> {}

enum Progress<T> {
    ToDo(Box<dyn FnOnce() -> T + Send>),
    Done(T),
    Running,
}

impl<T: Send + 'static> JobContext for Background<T> {
    type OffThread = Progress<T>;
    type Js = Next<T>;

    fn run(progress: &mut Progress<T>, done: Completion<Self>) -> Option<Completion<Self>> {
        if let Progress::ToDo(work) = core::mem::replace(progress, Progress::Running) {
            *progress = Progress::Done(work());
        }
        Some(done)
    }

    fn then(progress: Progress<T>, next: Next<T>, _: &JsThread<'_>) -> JsResult<()> {
        match progress {
            Progress::Done(result) => next.0(result),
            _ => Ok(()),
        }
    }
}

pub(crate) fn in_background<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
    next: impl FnOnce(T) -> JsResult<()> + 'static,
) {
    let thread = global().js_thread(global().bun_vm().root_context());
    Job::<Background<T>>::schedule(
        &thread,
        Progress::ToDo(Box::new(work)),
        Next(Box::new(next)),
    );
}

// ── the UI ──

pub(crate) fn ui() -> JsResult<&'static Ui> {
    bun_ui::start(global())
}

pub(crate) fn answer<T>(outcome: Outcome<T>) -> JsResult<T> {
    outcome.or_throw(global())
}

pub(crate) fn tell(command: Command) -> JsResult<()> {
    bun_ui::tell(global(), command)
}

pub(crate) fn tell_system(command: SystemCommand) -> JsResult<()> {
    tell(Command::System(command))
}

pub(crate) fn perform(command: SystemCommand) -> JsResult<()> {
    bun_ui::perform(global(), Command::System(command))
}

/// `false` where there is no such thing.
pub(crate) fn ask_shell(command: ShellCommand) -> JsResult<PreferenceValue> {
    match crate::IS_WINDOWS {
        true => answer((ui()?.ask_shell)(command)),
        false => Ok(PreferenceValue::Flag(false)),
    }
}

pub(crate) fn shell_agrees(command: ShellCommand) -> JsResult<bool> {
    Ok(matches!(ask_shell(command)?, PreferenceValue::Flag(true)))
}

pub(crate) fn is_headless() -> JsResult<bool> {
    bun_ui::is_headless(global())
}

/// `0xRRGGBBAA`
pub(crate) fn css_color(text: &[u8]) -> Option<u32> {
    use bun_css::values::color::{CssColor, RGBA};
    let arena = bun_alloc::Arena::new();
    let mut input = bun_css::ParserInput::new(text, &arena);
    let options = bun_css::css_parser::ParserOpts::CLIP_COLORS;
    let mut parser = bun_css::Parser::new(&mut input, None, options, None);
    let it = RGBA::try_from_css_color(&CssColor::parse(&mut parser).ok()?)?;
    Some(u32::from_be_bytes([it.red, it.green, it.blue, it.alpha]))
}

unsafe extern "C" {
    safe fn Bun__Desktop__functionPrototype(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Desktop__get(global: &JSGlobalObject, object: JSValue, key: JSValue) -> JSValue;
    safe fn Bun__Desktop__set(
        global: &JSGlobalObject,
        object: JSValue,
        key: JSValue,
        value: JSValue,
    );
    safe fn Bun__Desktop__await(
        global: &JSGlobalObject,
        value: JSValue,
        fulfilled: JSValue,
        rejected: JSValue,
    );
}
