//! Messages between realms, whatever their thread: https://html.spec.whatwg.org/#channel-messaging

use core::cell::RefCell;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU64, Ordering};
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;
use std::sync::Arc;

use bun_jsc::{JSGlobalObject, JSValue, JsResult, from_js_host_call, from_js_host_call_generic};
use bun_threading::Guarded;
use bun_ui::protocol::{Bitmap, ImageFormat};

pub(crate) use self::flat::{STORED_NULL, is_fit_for_storage};
use crate::client::Client;
use crate::exec::Thread;
use crate::remote::petition::{self, Handle, Tidings};
use crate::remote::{Peer, clerk};
use crate::storage::Shelf;
use crate::wire;

#[path = "channel_far.rs"]
pub(crate) mod far;
#[path = "channel_flat.rs"]
mod flat;

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
    fn Bun__SerializedScriptValue__memoryCost(value: NonNull<SerializedScriptValue>) -> usize;
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
    Flat(Arc<flat::Flat>),
    /// It could not leave the process that it is from.
    Unreadable,
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

    /// Of data alone, for another process.
    pub fn of_data(global: &JSGlobalObject, value: JSValue) -> JsResult<Serialized> {
        if let Some(immediate) = Serialized::immediate(value) {
            return Ok(immediate);
        }
        let how = bun_jsc::SerializedFlags {
            for_cross_process_transfer: true,
            for_storage: false,
        };
        let bytes = value.serialize(global, how)?.data().to_vec();
        Ok(Serialized(Form::Flat(Arc::new(flat::Flat::trusting(
            bytes,
        )))))
    }

    /// For tests: as if the check of what another process has sent had let it pass.
    pub fn unchecked(bytes: Vec<u8>) -> Serialized {
        Serialized(Form::Flat(Arc::new(flat::Flat::trusting(bytes))))
    }

    /// Of what `new` has made.
    pub fn size(&self) -> usize {
        match &self.0 {
            // SAFETY: it is alive.
            Form::Wire(wire) => unsafe { Bun__SerializedScriptValue__memoryCost(wire.0) },
            _ => 0,
        }
    }

    fn unreadable() -> Serialized {
        Serialized(Form::Unreadable)
    }

    pub fn deserialize(&self, global: &JSGlobalObject, objects: &[JSValue]) -> JsResult<JSValue> {
        match &self.0 {
            Form::Immediate(value) => Ok(JSValue::from_encoded(*value)),
            Form::Flat(value) => value.deserialize(global, objects),
            Form::Unreadable => Err(flat::unreadable(global)),
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
    Canvas(Box<dyn Graphic>),
}

pub trait Graphic: core::any::Any + Send {
    /// `None` if it cannot leave the process.
    fn loosen(self: Box<Self>) -> Option<LooseBitmap>;
}

crate::wire! {
    /// Not premultiplied.
    pub struct LooseBitmap {
        pub size: [u32; 2],
        pub rgba: Vec<u8>,
    }
}

impl LooseBitmap {
    pub async fn decode(bytes: Vec<u8>) -> Option<LooseBitmap> {
        let decode = bun_ui::loaded()?.decode_bitmap;
        // SAFETY: the parts of a slice.
        let work = move || unsafe { decode(bytes.as_ptr(), bytes.len()) }.get().ok();
        let it = crate::exec::blocking(work).await??;
        Some(LooseBitmap {
            size: [it.width, it.height],
            rgba: it.pixels.into_vec(),
        })
    }

    /// `None` if it does not have the size that it says.
    pub fn checked(self) -> Option<Bitmap> {
        let [width, height] = self.size;
        let bytes = (u64::from(width) * u64::from(height)).checked_mul(4)?;
        (bytes != 0 && bytes == self.rgba.len() as u64).then(|| Bitmap {
            width,
            height,
            pixels: self.rgba.into(),
        })
    }

    pub async fn into_png(self) -> Option<Vec<u8>> {
        let (encode, pixels) = (bun_ui::loaded()?.encode_bitmap, self.checked()?);
        let work = move || encode(&pixels, ImageFormat::Png, 0).get().ok();
        Some(crate::exec::blocking(work).await??.into_vec())
    }
}

impl Graphic for Option<LooseBitmap> {
    fn loosen(self: Box<Self>) -> Option<LooseBitmap> {
        *self
    }
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

crate::wire!(impl Message { value, transferred, kind });

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
    /// Of what another process has sent since it was empty.
    bytes_from_afar: usize,
    is_closed: bool,
    listener: Option<(Thread, u64)>,
    /// It is in another process, by that number.
    carrier: Option<(wire::Peer, u32)>,
}

type Listener = Rc<dyn Fn()>;

static LISTENERS: bun_ui::Lasting<RefCell<std::collections::BTreeMap<u64, Listener>>> =
    bun_ui::Lasting::empty();

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
        if let Some(carrier) = side.carrier {
            side.carrier.take_if(|_| is_end);
            side.is_closed = is_end;
            return far::pass_on(carrier, arrival);
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

#[derive(Clone)]
enum Member {
    Here(Address),
    In(Peer, u32),
}

#[derive(Default)]
struct Members {
    all: Vec<Member>,
    /// One for all in this process.
    in_host: Option<Arc<Handle>>,
}

static BROADCASTS: Guarded<BTreeMap<Box<[u8]>, Members>> = Guarded::new(BTreeMap::new());

fn leave_broadcast(key: &[u8], is_it: impl Fn(&Member) -> bool) {
    let mut all = BROADCASTS.lock();
    let Some(members) = all.get_mut(key) else {
        return;
    };
    members.all.retain(|it| !is_it(it));
    let last = members.all.is_empty().then(|| all.remove(key));
    drop(all);
    drop(last);
}

fn key_of_broadcast(partition: &[u8], name: &[u8]) -> Box<[u8]> {
    [partition, b"\n", name].concat().into()
}

fn broadcast(key: &[u8], value: &Serialized, is_other: impl Fn(&Member) -> bool) {
    let others: Vec<_> = (BROADCASTS.lock().get(key).iter())
        .flat_map(|it| it.all.iter().filter(|it| is_other(it)).cloned())
        .collect();
    for it in others {
        match it {
            Member::Here(it) => it.deliver(Arrival::Message(value.clone().into())),
            Member::In(peer, id) => clerk::tell(peer, id, Tidings::Broadcast(value.clone())),
        }
    }
}

/// https://html.spec.whatwg.org/#broadcasting-to-other-browsing-contexts
pub struct Broadcast {
    key: Box<[u8]>,
    pub endpoint: Endpoint,
    in_host: Option<Arc<Handle>>,
}

impl Broadcast {
    pub fn join(client: &Client, name: &[u8]) -> Broadcast {
        let address = Address {
            sides: Arc::default(),
            side: 0,
        };
        let key = key_of_broadcast(&client.partition_key(), name);
        let shelf = (client.session.storage.far_shelf(&client.bucket()))
            .filter(|_| !client.origin().is_opaque());
        let mut all = BROADCASTS.lock();
        let members = all.entry(key.clone()).or_default();
        members.all.push(Member::Here(address.clone()));
        if let Some(shelf) = shelf.filter(|_| members.in_host.is_none()) {
            let key = key.clone();
            let handle = Handle::with_listener(move |it| {
                if let Tidings::Broadcast(value) = it {
                    broadcast(&key, &value, |_| true);
                }
            });
            petition::join(handle.id(), shelf, name.into());
            members.in_host = Some(handle.into());
        }
        let in_host = members.in_host.clone();
        drop(all);
        Broadcast {
            key,
            endpoint: Endpoint(address),
            in_host,
        }
    }

    fn is(&self, member: &Member) -> bool {
        matches!(member, Member::Here(it) if Arc::ptr_eq(&it.sides, &self.endpoint.0.sides))
    }

    pub fn send(&self, value: &Serialized) {
        broadcast(&self.key, value, |it| !self.is(it));
        if let Some(handle) = &self.in_host {
            petition::broadcast(handle.id(), wire::Measured(value.clone(), 0));
        }
    }
}

impl Drop for Broadcast {
    fn drop(&mut self) {
        leave_broadcast(&self.key, |it| self.is(it));
    }
}

/// In the host, for one in a page process.
pub(crate) struct FarBroadcast {
    key: Box<[u8]>,
    peer: Peer,
    id: u32,
}

impl Address {
    /// For that many more bytes from another process.
    fn has_room_for(&self, bytes: usize) -> bool {
        const OVERHEAD: usize = 1 << 10;
        let mut side = self.sides[self.side].lock();
        side.bytes_from_afar *= usize::from(!side.inbox.is_empty());
        side.bytes_from_afar += bytes + OVERHEAD;
        side.bytes_from_afar <= 2 * wire::LARGE
    }
}

impl FarBroadcast {
    pub(crate) fn join(peer: Peer, id: u32, shelf: &Shelf, name: &[u8]) -> FarBroadcast {
        let partition = [&shelf.session.to_le_bytes(), &*shelf.bucket].concat();
        let key = key_of_broadcast(&partition, name);
        let mut all = BROADCASTS.lock();
        let members = &mut all.entry(key.clone()).or_default().all;
        members.retain(|it| !matches!(it, Member::In(of, _) if *of == peer));
        members.push(Member::In(peer, id));
        drop(all);
        FarBroadcast { key, peer, id }
    }

    /// To other processes.
    pub(crate) fn send(&self, value: &Serialized, bytes: usize) -> wire::Result<()> {
        let has_room = core::cell::Cell::new(true);
        broadcast(&self.key, value, |it| match it {
            Member::Here(it) => {
                has_room.update(|before| before && it.has_room_for(bytes));
                has_room.get()
            }
            Member::In(peer, _) => *peer != self.peer,
        });
        has_room.get().then_some(()).ok_or(wire::Malformed)
    }
}

impl Drop for FarBroadcast {
    fn drop(&mut self) {
        let is_it =
            |it: &Member| matches!(*it, Member::In(peer, id) if (peer, id) == (self.peer, self.id));
        leave_broadcast(&self.key, is_it);
    }
}
