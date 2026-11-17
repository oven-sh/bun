//! Messages between realms, whatever their thread: https://html.spec.whatwg.org/#channel-messaging

use core::cell::RefCell;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU64, Ordering};
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::Arc;

use bun_collections::HashMap;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, from_js_host_call, from_js_host_call_generic};
use bun_threading::Guarded;

use crate::exec::Thread;

bun_opaque::opaque_ffi! { struct SerializedScriptValue; }

unsafe extern "C" {
    fn Bun__SerializedScriptValue__create(
        global: &JSGlobalObject,
        value: JSValue,
        buffers: *const JSValue,
        buffer_count: usize,
        objects: *const JSValue,
        object_count: usize,
    ) -> Option<NonNull<SerializedScriptValue>>;
    fn Bun__SerializedScriptValue__deserialize(
        value: NonNull<SerializedScriptValue>,
        global: &JSGlobalObject,
        objects: *const JSValue,
        object_count: usize,
    ) -> JSValue;
    fn Bun__SerializedScriptSlice__free(value: NonNull<SerializedScriptValue>);
}

struct Wire(NonNull<SerializedScriptValue>);

// SAFETY: it holds nothing of a thread, and only one that nobody else has gives its buffers away.
unsafe impl Send for Wire {}
// SAFETY: see above.
unsafe impl Sync for Wire {}

impl Drop for Wire {
    fn drop(&mut self) {
        // SAFETY: this is the reference that `create` returned.
        unsafe { Bun__SerializedScriptSlice__free(self.0) }
    }
}

#[derive(Clone)]
enum Form {
    /// No cell.
    Immediate(usize),
    Wire(Arc<Wire>),
}

#[derive(Clone)]
pub struct Serialized(Form);

impl Serialized {
    pub fn immediate(value: JSValue) -> Option<Serialized> {
        (!value.is_cell()).then(|| Serialized(Form::Immediate(value.encoded())))
    }

    /// `buffers` are detached. `objects` stand for those that `deserialize` is given.
    pub fn new(
        global: &JSGlobalObject,
        value: JSValue,
        buffers: &[JSValue],
        objects: &[JSValue],
    ) -> JsResult<Serialized> {
        if let Some(immediate) = Serialized::immediate(value).filter(|_| buffers.is_empty()) {
            return Ok(immediate);
        }
        // SAFETY: the pointers and the lengths are those of slices.
        let wire = from_js_host_call_generic(global, || unsafe {
            Bun__SerializedScriptValue__create(
                global,
                value,
                buffers.as_ptr(),
                buffers.len(),
                objects.as_ptr(),
                objects.len(),
            )
        })?;
        Ok(Serialized(Form::Wire(Arc::new(Wire(
            wire.expect("an exception or a value"),
        )))))
    }

    pub fn deserialize(&self, global: &JSGlobalObject, objects: &[JSValue]) -> JsResult<JSValue> {
        match &self.0 {
            Form::Immediate(value) => Ok(JSValue::from_encoded(*value)),
            // SAFETY: as in `new`.
            Form::Wire(wire) => from_js_host_call(global, || unsafe {
                Bun__SerializedScriptValue__deserialize(
                    wire.0,
                    global,
                    objects.as_ptr(),
                    objects.len(),
                )
            }),
        }
    }
}

pub enum Transferred {
    Port(Endpoint),
    ReadableStream(Endpoint),
    WritableStream(Endpoint),
    TransformStream {
        readable: Endpoint,
        writable: Endpoint,
    },
    Canvas(Box<dyn core::any::Any + Send>),
}

pub struct Message {
    pub value: Serialized,
    pub transferred: Vec<Transferred>,
    /// What those who talk have agreed on.
    pub kind: u8,
}

impl Message {
    /// For who knows no transferable object but ports. The value has null in their place.
    pub fn open(self, global: &JSGlobalObject) -> JsResult<(JSValue, Vec<Endpoint>)> {
        let value = self
            .value
            .deserialize(global, &vec![JSValue::NULL; self.transferred.len()])?;
        let port = |it| {
            if let Transferred::Port(it) = it {
                Some(it)
            } else {
                None
            }
        };
        Ok((
            value,
            self.transferred.into_iter().filter_map(port).collect(),
        ))
    }
}

impl From<Serialized> for Message {
    fn from(value: Serialized) -> Message {
        Message {
            value,
            transferred: Vec::new(),
            kind: 0,
        }
    }
}

pub enum Arrival {
    Message(Message),
    Closed,
}

#[derive(Default)]
struct Side {
    inbox: VecDeque<Arrival>,
    is_closed: bool,
    listener: Option<(Thread, u64)>,
}

type Listener = Rc<dyn Fn()>;

thread_local! {
    static LISTENERS: ManuallyDrop<RefCell<HashMap<u64, Listener>>> = bun_ui::lasting(|| drop(LISTENERS.with(|it| it.take())));
}

fn tell(id: u64) {
    if let Some(listener) = LISTENERS.with(|it| it.borrow().get(&id).cloned()) {
        listener();
    }
}

/// Who can put something into the inbox of an end.
#[derive(Clone)]
struct Address {
    sides: Arc<[Guarded<Side>; 2]>,
    side: usize,
}

impl Address {
    fn deliver(&self, arrival: Arrival) {
        let (mut side, is_end) = (
            self.sides[self.side].lock(),
            matches!(arrival, Arrival::Closed),
        );
        if side.is_closed {
            drop(side);
            return;
        }
        side.inbox.push_back(arrival);
        let Some((thread, id)) = side.listener.clone() else {
            return;
        };
        drop(side);
        // The collector closes ports, too.
        if thread.is_current() && !is_end {
            tell(id);
        } else {
            thread.post(move || tell(id));
        }
    }
}

/// An end of a channel. Dropping it closes it.
pub struct Endpoint(Address);

static PARKED: Guarded<Vec<(f64, Endpoint)>> = Guarded::new(Vec::new());

impl Endpoint {
    pub fn pair() -> (Endpoint, Endpoint) {
        let sides: Arc<[Guarded<Side>; 2]> = Arc::default();
        (
            Endpoint(Address {
                sides: Arc::clone(&sides),
                side: 0,
            }),
            Endpoint(Address { sides, side: 1 }),
        )
    }

    /// A number that nobody guesses. It stands for this until it is given to [`unpark`](Self::unpark).
    pub fn park(self) -> f64 {
        let mut random = [0; 8];
        bun_boringssl_sys::rand_bytes(&mut random);
        let id = (u64::from_le_bytes(random) >> 11) as f64;
        PARKED.lock().push((id, self));
        id
    }

    pub fn unpark(id: f64) -> Endpoint {
        let parked = PARKED.lock().extract_if(.., |it| it.0 == id).next();
        parked.map_or_else(|| Endpoint::pair().0, |it| it.1)
    }

    fn peer(&self) -> Address {
        Address {
            sides: Arc::clone(&self.0.sides),
            side: 1 - self.0.side,
        }
    }

    pub fn send(&self, message: Message) {
        let is_doomed = message.transferred.iter().any(
            |it| matches!(it, Transferred::Port(it) if Arc::ptr_eq(&it.0.sides, &self.0.sides)),
        );
        if !is_doomed {
            self.peer().deliver(Arrival::Message(message));
        }
    }

    /// `listener` is called on this thread, once for each arrival. It must not run scripts.
    pub fn listen(&self, listener: Listener) {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        self.stop_listening();
        LISTENERS.with(|it| it.borrow_mut().insert(id, listener));
        let mut side = self.0.sides[self.0.side].lock();
        side.listener = Some((Thread::current(), id));
        let waiting = side.inbox.len();
        drop(side);
        (0..waiting).for_each(|_| tell(id));
    }

    /// On the thread that listens.
    pub fn stop_listening(&self) {
        let listener = self.0.sides[self.0.side].lock().listener.take();
        drop(listener.and_then(|it| LISTENERS.with(|all| all.borrow_mut().remove(&it.1))));
    }

    pub fn take(&self) -> Option<Arrival> {
        self.0.sides[self.0.side].lock().inbox.pop_front()
    }

    fn close(&self) -> VecDeque<Arrival> {
        self.stop_listening();
        let mut side = self.0.sides[self.0.side].lock();
        let (was_closed, left) = (
            core::mem::replace(&mut side.is_closed, true),
            core::mem::take(&mut side.inbox),
        );
        drop(side);
        if !was_closed {
            self.peer().deliver(Arrival::Closed);
        }
        left
    }
}

impl Drop for Endpoint {
    /// Without recursion: a script decides how deeply ports are nested.
    fn drop(&mut self) {
        let mut left = self.close();
        while let Some(arrival) = left.pop_front() {
            let Arrival::Message(message) = arrival else {
                continue;
            };
            for transferred in message.transferred {
                match transferred {
                    Transferred::Port(it)
                    | Transferred::ReadableStream(it)
                    | Transferred::WritableStream(it) => left.extend(it.close()),
                    Transferred::TransformStream { readable, writable } => {
                        left.extend(readable.close().into_iter().chain(writable.close()))
                    }
                    Transferred::Canvas(_) => {}
                }
            }
        }
    }
}

static BROADCASTS: Guarded<Vec<(Box<[u8]>, Address)>> = Guarded::new(Vec::new());

/// https://html.spec.whatwg.org/#broadcasting-to-other-browsing-contexts
pub struct Broadcast {
    key: Box<[u8]>,
    pub endpoint: Endpoint,
}

impl Broadcast {
    pub fn join(key: Box<[u8]>) -> Broadcast {
        let address = Address {
            sides: Arc::default(),
            side: 0,
        };
        BROADCASTS.lock().push((key.clone(), address.clone()));
        Broadcast {
            key,
            endpoint: Endpoint(address),
        }
    }

    pub fn send(&self, value: &Serialized) {
        let is_other = |it: &&(Box<[u8]>, Address)| {
            it.0 == self.key && !Arc::ptr_eq(&it.1.sides, &self.endpoint.0.sides)
        };
        let others: Vec<_> = BROADCASTS
            .lock()
            .iter()
            .filter(is_other)
            .map(|it| it.1.clone())
            .collect();
        others
            .iter()
            .for_each(|it| it.deliver(Arrival::Message(value.clone().into())));
    }
}

impl Drop for Broadcast {
    fn drop(&mut self) {
        BROADCASTS
            .lock()
            .retain(|it| !Arc::ptr_eq(&it.1.sides, &self.endpoint.0.sides));
    }
}
