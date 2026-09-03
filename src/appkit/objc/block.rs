//! Blocks whose body is a function a script gave: `objc.block()` in
//! `bun:objc`, and a JavaScript function passed where a method takes a
//! block whose signature [`super::sdk::BLOCK_PARAMS`] lists.
//!
//! A block is a C struct the compiler normally lays out. Here [`Literal`] lays
//! it out by hand with one captured variable, a pointer to the script's side
//! ([`Data`]), and `_Block_copy` moves it to the heap so whoever it is handed
//! to can keep it (`Block_copy` / `Block_release`) past the call. A block's
//! `invoke` function must have the block's exact C signature: a libffi
//! closure made once per signature ([`ffi::Closure`]), or one of the compiled
//! shims ([`SIGNATURES`]), which are what still works without libffi and go
//! when its NSInvocation switch does (see [`super::dynamic`]); either packs its
//! arguments into [`Frame`]s for one shared body, which decodes them the way
//! [`super::dynamic`] decodes message results, calls the script, and encodes
//! what it returns. The descriptor carries the signature string
//! (`BLOCK_HAS_SIGNATURE`), which Foundation reads when it wants an
//! `NSMethodSignature` for the block, and a dispose helper that frees `Data`
//! once the last reference is released. The function runs on the thread that
//! made the block (see [`handoff`]): a call anywhere else is handed over to
//! that thread when nothing is wanted back from it, and returns zero
//! otherwise.

use core::ffi::{CStr, c_char, c_void};
use core::ptr::null_mut;
use core::sync::atomic::{AtomicI32, AtomicPtr, Ordering};
use std::ffi::CString;

use super::dynamic::{
    self, CHAR, Callee, DynObject, DynValue, Enc, Family, Frame, HandedOver, NS_RANGE, Pointee,
    Reply, Signature, Spelling, decode, encode_result, frames_of, leave_result, pool_if_none,
    read_out, write_out,
};
use super::ffi;
use super::foundation::NSMethodSignature;
use super::handoff::{self, Owner};
use super::{Bool, Class, Obj, Object, load, lookup_class, rt};
use crate::error::{Error, Result};
use crate::geometry::Range;

// ────────────────────────────────── ABI ──────────────────────────────────────

/// `struct Block_literal` with one captured pointer.
#[repr(C)]
struct Literal {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    invoke: *const c_void,
    descriptor: *const Descriptor,
    data: *mut Data,
}

/// `struct Block_descriptor` for a literal with copy/dispose helpers and a
/// signature.
#[repr(C)]
struct Descriptor {
    reserved: usize,
    size: usize,
    copy: unsafe extern "C" fn(dst: *mut Literal, src: *const Literal),
    dispose: unsafe extern "C" fn(block: *mut Literal),
    signature: *const c_char,
    layout: *const c_char,
}

const BLOCK_HAS_COPY_DISPOSE: i32 = 1 << 25;
const BLOCK_HAS_SIGNATURE: i32 = 1 << 30;

unsafe extern "C" {
    /// The class of a block that lives on the stack; `_Block_copy` reads it
    /// to know the literal must be copied rather than retained.
    static _NSConcreteStackBlock: [*const c_void; 32];
    /// A heap copy of `block` with one reference, made with `malloc` and the
    /// literal's copy helper.
    fn _Block_copy(block: *const c_void) -> *mut c_void;
}

/// What a block's captured pointer points at, from `_Block_copy` until the
/// dispose helper runs. `handler` is only touched on `owner`'s thread.
struct Data {
    shim: &'static Shim,
    owner: &'static Owner,
    handler: Box<dyn BlockFn>,
}

// ─────────────────────────────── script side ─────────────────────────────────

/// One call of a block.
pub struct Call<'a> {
    /// `block v@?@Q^B`, for messages.
    pub method: &'a str,
    /// One per parameter; an [`Enc::Out`] parameter (an enumeration's
    /// `BOOL *stop`) arrives as the value it points at, zero for NULL.
    pub args: Vec<DynValue>,
    pub params: &'a [Enc],
    /// What the returned value will be encoded as.
    pub ret: &'a Enc,
}

/// The script side of a block. Runs on the thread that made the block,
/// inside whatever called it, so it may be re-entered.
pub trait BlockFn {
    /// A `None` value also sets every `BOOL *` argument, so an enumeration
    /// stops.
    fn call(&self, call: Call<'_>) -> Reply;
    /// A call that could not be delivered or answered for a reason on this
    /// side; the caller reads zero, so the script is told this way.
    fn report(&self, err: Error);
}

// ──────────────────────────────── the table ──────────────────────────────────

/// One block signature: its type encoding (return type, `@?` for the block
/// itself, one code per argument), the `invoke` function with that C
/// signature (a compiled shim or a closure), and the descriptor every block
/// of that signature shares. Lives for the process.
struct Shim {
    types: &'static CStr,
    /// `block v@?@Q^B`, for messages.
    name: &'static str,
    /// The invoke function's return and parameter types (for a compiled
    /// shim, from its Rust signature, which [`verify`] checks `types` agrees
    /// with).
    ret: Enc,
    params: &'static [Enc],
    invoke: *const c_void,
    descriptor: Descriptor,
}

// SAFETY: immutable; the pointers are to functions and static strings.
unsafe impl Sync for Shim {}

/// A [`Shim`] whose invoke function is a closure, made the first time a
/// block of its signature was; see [`CLOSURE_SHIMS`].
struct ClosureShim {
    next: *const ClosureShim,
    shim: Shim,
}

/// Every [`ClosureShim`] any thread has made, newest first: pushed once and
/// never removed, so any thread may walk it (and two threads making the
/// same signature at once merely make two).
static CLOSURE_SHIMS: AtomicPtr<ClosureShim> = AtomicPtr::new(null_mut());

fn closure_shims() -> impl Iterator<Item = &'static Shim> {
    // SAFETY: the head and every `next` are null or a `ClosureShim` leaked
    // by `closure_shim` and published with `Release` after it was complete.
    let head = unsafe { CLOSURE_SHIMS.load(Ordering::Acquire).as_ref() };
    // SAFETY: as above.
    core::iter::successors(head, |c| unsafe { c.next.as_ref() }).map(|c| &c.shim)
}

/// A C type a shim takes or returns: its encoding, and the bytes a [`Frame`]
/// holds it in (the layout [`dynamic::encode`] writes and [`decode`] reads for that
/// encoding).
trait Raw: Copy {
    const ENC: Enc;
    fn frame(self) -> Frame;
    fn read(frame: &Frame) -> Self;
}

impl Raw for () {
    const ENC: Enc = Enc::Void;
    fn frame(self) -> Frame {
        Frame::new()
    }
    fn read(_: &Frame) {}
}

impl Raw for Obj {
    const ENC: Enc = Enc::Object;
    fn frame(self) -> Frame {
        let mut f = Frame::new();
        f.word(self as usize);
        f
    }
    fn read(frame: &Frame) -> Obj {
        frame.read_word() as Obj
    }
}

impl Raw for Bool {
    const ENC: Enc = Enc::Bool;
    fn frame(self) -> Frame {
        let mut f = Frame::new();
        f.put(0, &[u8::from(self.get())]);
        f
    }
    fn read(frame: &Frame) -> Bool {
        Bool::new(frame.read_word() & 0xff != 0)
    }
}

impl Raw for i64 {
    const ENC: Enc = Enc::Int {
        bits: 64,
        signed: true,
    };
    fn frame(self) -> Frame {
        let mut f = Frame::new();
        f.put(0, &self.to_ne_bytes());
        f
    }
    fn read(frame: &Frame) -> i64 {
        frame.read_word() as i64
    }
}

impl Raw for u64 {
    const ENC: Enc = Enc::Int {
        bits: 64,
        signed: false,
    };
    fn frame(self) -> Frame {
        let mut f = Frame::new();
        f.put(0, &self.to_ne_bytes());
        f
    }
    fn read(frame: &Frame) -> u64 {
        frame.read_word() as u64
    }
}

impl Raw for f64 {
    const ENC: Enc = Enc::F64;
    fn frame(self) -> Frame {
        let mut f = Frame::new();
        f.put(0, &self.to_ne_bytes());
        f
    }
    fn read(frame: &Frame) -> f64 {
        f64::from_bits(frame.read_word() as u64)
    }
}

impl Raw for Range {
    const ENC: Enc = Enc::Struct(&NS_RANGE);
    fn frame(self) -> Frame {
        let mut f = Frame::new();
        f.put(0, &(self.location as u64).to_ne_bytes());
        f.put(8, &(self.length as u64).to_ne_bytes());
        f
    }
    fn read(frame: &Frame) -> Range {
        Range {
            location: frame.read_u64(0) as usize,
            length: frame.read_u64(1) as usize,
        }
    }
}

/// `BOOL *`.
type BoolPtr = *mut Bool;

impl Raw for BoolPtr {
    const ENC: Enc = Enc::Out(Pointee::Bool);
    fn frame(self) -> Frame {
        let mut f = Frame::new();
        f.word(self as usize);
        f
    }
    fn read(frame: &Frame) -> BoolPtr {
        frame.read_word() as BoolPtr
    }
}

const fn c_str(text: &'static str) -> &'static CStr {
    match CStr::from_bytes_with_nul(text.as_bytes()) {
        Ok(c) => c,
        Err(_) => panic!("NUL inside a block signature"),
    }
}

macro_rules! shims {
    ($( $types:literal => fn $name:ident($($arg:ident: $ty:ty),*) -> $ret:ty; )*) => {
        $(
            unsafe extern "C" fn $name(block: *mut Literal $(, $arg: $ty)*) -> $ret {
                let args: &[Frame] = &[$(Raw::frame($arg)),*];
                // SAFETY: the blocks runtime calls `invoke` with the block it
                // belongs to, which [`make`] built, and arguments of its signature.
                let ret = unsafe { invoke(block, args) };
                <$ret as Raw>::read(&ret)
            }
        )*

        /// The block signatures with a compiled invoke function, tried
        /// first; any other gets a closure. Kept only for as long as the
        /// NSInvocation switch that disables libffi is.
        static SIGNATURES: &[Shim] = &[$(
            Shim {
                types: c_str(concat!($types, "\0")),
                name: concat!("block ", $types),
                ret: <$ret as Raw>::ENC,
                params: &[$(<$ty as Raw>::ENC),*],
                invoke: $name as unsafe extern "C" fn(*mut Literal $(, $ty)*) -> $ret as *const c_void,
                descriptor: Descriptor {
                    reserved: 0,
                    size: core::mem::size_of::<Literal>(),
                    copy,
                    dispose,
                    signature: c_str(concat!($types, "\0")).as_ptr(),
                    layout: core::ptr::null(),
                },
            }
        ),*];
    };
}

shims! {
    "v@?" => fn invoke_v() -> ();
    "v@?@" => fn invoke_v_o(a: Obj) -> ();
    "v@?@@" => fn invoke_v_oo(a: Obj, b: Obj) -> ();
    "v@?@@@" => fn invoke_v_ooo(a: Obj, b: Obj, c: Obj) -> ();
    "v@?B" => fn invoke_v_b(a: Bool) -> ();
    "v@?q" => fn invoke_v_q(a: i64) -> ();
    "v@?Q" => fn invoke_v_uq(a: u64) -> ();
    "v@?d" => fn invoke_v_d(a: f64) -> ();
    "v@?@B" => fn invoke_v_ob(a: Obj, b: Bool) -> ();
    "v@?@q" => fn invoke_v_oq(a: Obj, b: i64) -> ();
    "v@?@Q" => fn invoke_v_ouq(a: Obj, b: u64) -> ();
    "v@?@d" => fn invoke_v_od(a: Obj, b: f64) -> ();
    "v@?@@q" => fn invoke_v_ooq(a: Obj, b: Obj, c: i64) -> ();
    "v@?@^B" => fn invoke_v_os(a: Obj, b: BoolPtr) -> ();
    "v@?Q^B" => fn invoke_v_uqs(a: u64, b: BoolPtr) -> ();
    "v@?@Q^B" => fn invoke_v_ouqs(a: Obj, b: u64, c: BoolPtr) -> ();
    "v@?@@^B" => fn invoke_v_oos(a: Obj, b: Obj, c: BoolPtr) -> ();
    "v@?@{_NSRange=QQ}^B" => fn invoke_v_ors(a: Obj, b: Range, c: BoolPtr) -> ();
    "@@?" => fn invoke_o() -> Obj;
    "@@?@" => fn invoke_o_o(a: Obj) -> Obj;
    "@@?@@" => fn invoke_o_oo(a: Obj, b: Obj) -> Obj;
    "@@?@@@" => fn invoke_o_ooo(a: Obj, b: Obj, c: Obj) -> Obj;
    "B@?@" => fn invoke_b_o(a: Obj) -> Bool;
    "B@?@@" => fn invoke_b_oo(a: Obj, b: Obj) -> Bool;
    "B@?@^B" => fn invoke_b_os(a: Obj, b: BoolPtr) -> Bool;
    "B@?@Q^B" => fn invoke_b_ouqs(a: Obj, b: u64, c: BoolPtr) -> Bool;
    "B@?@@^B" => fn invoke_b_oos(a: Obj, b: Obj, c: BoolPtr) -> Bool;
    "q@?@" => fn invoke_q_o(a: Obj) -> i64;
    "q@?@@" => fn invoke_q_oo(a: Obj, b: Obj) -> i64;
}

/// The encodings with a compiled invoke function, comma separated: what a
/// block can be without libffi closures, for messages.
pub fn compiled() -> String {
    SIGNATURES
        .iter()
        .map(|s| s.types.to_string_lossy())
        .collect::<Vec<_>>()
        .join(", ")
}

/// Whether a block of any signature can be made here (libffi closures), or
/// only the [`compiled`] ones.
pub fn any_signature() -> bool {
    ffi::closures_available()
}

// ─────────────────────────────── making one ──────────────────────────────────

/// `types` as `NSMethodSignature` split it: the return type and one type
/// per argument after the block itself, which must come first.
fn split(types: &str, ns: &NSMethodSignature, spelling: Spelling) -> Result<(Enc, Vec<Enc>)> {
    if ns.number_of_arguments() < 1
        || Enc::parse(&ns.argument_type_at(0).0.unwrap_or_default()) != Enc::Block
    {
        return Err(Error::BlockSignature {
            types: types.to_owned(),
            what: "must start with the return type followed by \"@?\" for the block itself".into(),
        });
    }
    let ret = Enc::parse_as(
        ns.method_return_type().0.as_deref().unwrap_or("v"),
        spelling,
    );
    let params = (1..ns.number_of_arguments())
        .map(|i| Enc::parse_as(&ns.argument_type_at(i).0.unwrap_or_default(), spelling))
        .collect();
    Ok((ret, params))
}

/// `types` (which a script or the SDK tables wrote) parsed and split.
fn parse(types: &str) -> Result<(NSMethodSignature, Enc, Vec<Enc>)> {
    let ns = dynamic::method_signature(types, |why| Error::BlockSignature {
        types: types.to_owned(),
        what: format!("is not a valid type encoding{why}"),
    })?;
    let (ret, params) = split(types, &ns, Spelling::Written)?;
    Ok((ns, ret, params))
}

/// The shim whose invoke function has this return type and these parameters
/// (frame offsets, qualifiers and the x86_64 spelling of `BOOL` aside): a
/// compiled one, one made before, or a new closure; `types` is what they
/// were parsed from, for the message.
fn find(types: &str, ns: NSMethodSignature, ret: Enc, params: Vec<Enc>) -> Result<&'static Shim> {
    let matches = |shim: &&Shim| shim.ret == ret && *shim.params == *params;
    if let Some(shim) = SIGNATURES
        .iter()
        .find(matches)
        .or_else(|| closure_shims().find(matches))
    {
        return Ok(shim);
    }
    let refuse = |what: String| Error::BlockSignature {
        types: types.to_owned(),
        what,
    };
    if !ffi::closures_available() {
        return Err(refuse(format!(
            "is not one a JavaScript function can be called through without libffi closures, which are not available here; the ones that need none are {}",
            compiled()
        )));
    }
    for (index, enc) in params.iter().enumerate() {
        if let Enc::Other(e) = enc {
            return Err(refuse(format!(
                "has argument {index} of type {e}, which is not supported"
            )));
        }
    }
    if let Enc::CString | Enc::Out(_) | Enc::Buffer(_) | Enc::Pointer | Enc::Other(_) = ret {
        return Err(refuse(format!(
            "returns {ret}, which a JavaScript function cannot return through a block"
        )));
    }
    closure_shim(ns, ret, params).map_err(refuse)
}

/// Builds the [`Shim`] for a signature no block has had yet: a closure
/// entered as [`enter`] with the shim itself as its data, published on
/// [`CLOSURE_SHIMS`].
fn closure_shim(
    ns: NSMethodSignature,
    ret: Enc,
    params: Vec<Enc>,
) -> core::result::Result<&'static Shim, String> {
    // Every block of this shape shares the shim, so it advertises the
    // signature as normalised, not as the first script spelled it.
    let types = spelled(&ns);
    let name = format!("block {types}");
    let mut sig = Signature::parsed(
        ns,
        Callee::Block,
        name.clone(),
        Family::None,
        Spelling::Written,
    );
    sig.check_return().map_err(|e| e.to_string())?;
    sig.prepare();
    let call = sig
        .call_interface()
        .ok_or_else(|| "has a type libffi cannot lay out".to_owned())?;
    let c_types: &'static CStr = Box::leak(
        CString::new(types)
            .map_err(|_| "contains NUL".to_owned())?
            .into_boxed_c_str(),
    );
    let node = bun_core::heap::into_raw(Box::new(ClosureShim {
        next: null_mut(),
        shim: Shim {
            types: c_types,
            name: Box::leak(name.into_boxed_str()),
            ret,
            params: Box::leak(params.into_boxed_slice()),
            invoke: core::ptr::null(),
            descriptor: Descriptor {
                reserved: 0,
                size: core::mem::size_of::<Literal>(),
                copy,
                dispose,
                signature: c_types.as_ptr(),
                layout: core::ptr::null(),
            },
        },
    }));
    // SAFETY: `enter` reads its arguments and writes its result by the
    // shim's `params` and `ret`, which are what `call` was prepared from
    // (the block pointer leading), and gets the shim, which is never freed,
    // as its data.
    let closure =
        unsafe { ffi::Closure::new(call, enter, (&raw const (*node).shim).cast_mut().cast()) };
    let Some(closure) = closure else {
        // SAFETY: not published, so still ours.
        drop(unsafe { bun_core::heap::take(node) });
        return Err("could not be given a libffi closure".to_owned());
    };
    // SAFETY: just leaked; only this thread sees it until the exchange below.
    unsafe { (*node).shim.invoke = closure.code() };
    let mut head = CLOSURE_SHIMS.load(Ordering::Relaxed);
    loop {
        // SAFETY: as above.
        unsafe { (*node).next = head };
        match CLOSURE_SHIMS.compare_exchange_weak(head, node, Ordering::Release, Ordering::Relaxed)
        {
            Ok(_) => break,
            Err(current) => head = current,
        }
    }
    // SAFETY: leaked, so it lives for the process.
    Ok(unsafe { &(*node).shim })
}

/// What a closure standing in for a block's invoke function enters: the
/// same body the compiled shims share.
unsafe extern "C" fn enter(
    _cif: *mut c_void,
    ret: *mut c_void,
    args: *mut *mut c_void,
    shim: *mut c_void,
) {
    // SAFETY: the data `closure_shim` made the closure with.
    let shim = unsafe { &*shim.cast::<Shim>() };
    // SAFETY: the blocks runtime calls `invoke` with the block first, then
    // arguments of its signature, which is what the closure was prepared for.
    let (block, frames) = unsafe {
        (
            (*args).cast::<*mut Literal>().read(),
            frames_of(shim.params, args.add(1)),
        )
    };
    // SAFETY: as above; the block is one `make` built.
    let out = unsafe { invoke(block, &frames) };
    // SAFETY: `ret` is where the caller reads a result of type `shim.ret`.
    unsafe { leave_result(&shim.ret, &out, ret) };
}

/// A heap block of type `types` whose body is `handler`, as an object:
/// retaining and releasing it are `Block_copy` and `Block_release`, and
/// `handler` is dropped (on this thread) when the last reference goes.
pub fn make(types: &str, handler: Box<dyn BlockFn>) -> Result<DynObject> {
    load()?;
    let _pool = pool_if_none();
    let (ns, ret, params) = parse(types)?;
    let shim = find(types, ns, ret, params)?;
    let data = bun_core::heap::into_raw(Box::new(Data {
        shim,
        owner: handoff::current(),
        handler,
    }));
    let literal = Literal {
        isa: core::ptr::addr_of!(_NSConcreteStackBlock).cast(),
        flags: BLOCK_HAS_COPY_DISPOSE | BLOCK_HAS_SIGNATURE,
        reserved: 0,
        invoke: shim.invoke,
        descriptor: &raw const shim.descriptor,
        data,
    };
    // SAFETY: a complete stack block literal whose descriptor gives its size;
    // the copy owns `data` from here on (see `copy`).
    let heap = unsafe { _Block_copy(core::ptr::from_ref(&literal).cast()) };
    // SAFETY: `_Block_copy` returns NULL or a +1 `NSBlock`, which is an object.
    match unsafe { DynObject::from_retained(heap) } {
        Some(block) => Ok(block),
        None => {
            // SAFETY: no copy was made, so `data` is still ours.
            drop(unsafe { bun_core::heap::take(data) });
            Err(Error::BlockSignature {
                types: types.to_owned(),
                what: "could not be copied to the heap".into(),
            })
        }
    }
}

/// A reference of the caller's own to the block at `block`, the way
/// `objc_retainBlock` takes one: a block on the heap (or a global one) is
/// retained, a block on some caller's stack is copied to the heap, since
/// retaining that extends nothing past the caller's frame.
///
/// # Safety
/// `block` is nil or a live block.
pub(super) unsafe fn own(block: Obj) -> Option<DynObject> {
    // SAFETY: per contract; `copy_raw` returns NULL or a +1 `NSBlock`.
    unsafe { DynObject::from_retained(copy_raw(block)) }
}

/// [`own`], as the raw +1 reference (NULL for NULL).
///
/// # Safety
/// As [`own`].
pub(super) unsafe fn copy_raw(block: Obj) -> Obj {
    // SAFETY: per contract.
    unsafe { _Block_copy(block.cast_const()) }
}

/// Whether `class` is a block class (an `NSBlock`), read from the runtime.
pub(super) fn is_block(class: Class) -> bool {
    lookup_class(c"NSBlock").is_some_and(|b| rt().class_inherits(class, b))
}

const BLOCK_REFCOUNT_MASK: i32 = 0xfffe;

/// How many references there are to the heap block `block`: the runtime
/// keeps the count in `flags`, in steps of two (`-retainCount` on a block
/// always says 1).
///
/// # Safety
/// `block` is a live heap block.
pub(super) unsafe fn retain_count(block: *const c_void) -> usize {
    // SAFETY: per contract; `flags` is the word `Block_copy` and
    // `Block_release` update atomically, read the same way.
    let flags =
        unsafe { &*core::ptr::addr_of!((*block.cast::<Literal>()).flags).cast::<AtomicI32>() };
    ((flags.load(Ordering::Relaxed) & BLOCK_REFCOUNT_MASK) >> 1) as usize
}

/// Called once, by `_Block_copy` moving the literal to the heap: the bitwise
/// copy already carried `data` across and the stack literal is never used
/// again, so ownership simply moves.
unsafe extern "C" fn copy(_dst: *mut Literal, _src: *const Literal) {}

/// Called when the heap block's last reference is released, on whichever
/// thread that happens; `Data` holds the script's values, which are only
/// let go on the thread that made the block.
unsafe extern "C" fn dispose(block: *mut Literal) {
    // SAFETY: `block` is the heap copy `make` had made, being deallocated;
    // `data` is what `make` leaked and nothing else frees; `owner` is a
    // `&'static` written once by `make`.
    unsafe {
        let data = (*block).data;
        handoff::free_on_owner((*data).owner, data);
    }
}

/// Runs the script behind `block` with `args` (one frame per block argument,
/// in its C layout) and returns its result laid out for the block's return
/// type; zero when it cannot. A caller on another thread than the block's
/// gets zero: the call is handed over to the block's thread to be made
/// later when it returns nothing and takes no pointers, and refused (the
/// block's thread is told) otherwise.
///
/// # Safety
/// `block` is a live block [`make`] built, being invoked with arguments of
/// its signature.
unsafe fn invoke(block: *mut Literal, args: &[Frame]) -> Frame {
    // SAFETY: per contract, and `data` lives as long as the block, which the
    // caller holds a reference to at least until this is entered.
    let data = unsafe { (*block).data };
    // SAFETY: `shim` and `owner` are `&'static`s written once by `make`;
    // nothing else in `Data` is touched until the thread is known to be
    // the owner's.
    let (shim, owner) = unsafe { ((*data).shim, (*data).owner) };
    if !owner.is_current() {
        match HandedOver::refused(&shim.ret, shim.params) {
            Some(why) => owner.wrong_thread(shim.name.to_owned(), why),
            None => {
                // SAFETY: a live heap block, kept for the handed-over call;
                // `args` are of `shim.params`' types, live now.
                let call =
                    unsafe { HandedOver::new((rt().objc_retain)(block.cast()), shim.params, args) };
                owner.hand_over(
                    shim.name,
                    Box::new(move || {
                        // SAFETY: the block `call` holds, on its owner's
                        // thread now, with the arguments it kept alive.
                        unsafe { invoke(call.receiver.cast(), &call.frames) };
                        drop(call);
                    }),
                );
            }
        }
        return Frame::new();
    }
    if owner.retired() {
        return Frame::new();
    }
    // The script may let go of every other reference while it runs (its own
    // handle, or the framework's by what it calls), so hold one for the call.
    // SAFETY: a live heap block; retain and release are Block_copy/Block_release.
    let block = unsafe { (rt().objc_retain)(block.cast()) };
    // SAFETY: `data` cannot be disposed of while that reference is held.
    let data = unsafe { &*data };
    let mut out = Frame::new();
    if let Err(err) = deliver(data, args, &mut out) {
        data.handler.report(err);
        out = Frame::new();
    }
    // SAFETY: the reference taken above.
    unsafe { (rt().objc_release)(block) };
    out
}

fn deliver(data: &Data, frames: &[Frame], out: &mut Frame) -> Result<()> {
    let shim = data.shim;
    let mut args = Vec::with_capacity(frames.len());
    for (enc, frame) in shim.params.iter().zip(frames) {
        args.push(match enc {
            Enc::Out(pointee) => read_out(shim.name, *pointee, frame)?,
            _ => decode(shim.name, enc, false, frame)?,
        });
    }
    let reply = data.handler.call(Call {
        method: shim.name,
        args,
        params: shim.params,
        ret: &shim.ret,
    });
    for (index, value) in &reply.outs {
        if let (Some(Enc::Out(pointee)), Some(frame)) =
            (shim.params.get(*index), frames.get(*index))
        {
            write_out(shim.name, *index, *pointee, frame, value)?;
        }
    }
    let Some(value) = reply.value else {
        for (index, (enc, frame)) in shim.params.iter().zip(frames).enumerate() {
            if *enc == Enc::Out(Pointee::Bool) {
                write_out(
                    shim.name,
                    index,
                    Pointee::Bool,
                    frame,
                    &DynValue::Bool(true),
                )?;
            }
        }
        return Ok(());
    };
    if shim.ret == Enc::Void {
        return Ok(());
    }
    encode_result(shim.name, &shim.ret, Family::None, &value, out)
}

// ──────────────────────────────── checking ───────────────────────────────────

/// For [`super::verify_bindings`]: every shim's encoding matches its Rust
/// signature and parses; [`super::sdk::BLOCK_PARAMS`] is sorted and every
/// encoding in it parses.
pub(super) fn verify(problems: &mut Vec<String>) {
    // Fixed strings, so `NSMethodSignature` is asked directly; one it cannot
    // parse raises, which fails the check as surely as a problem line.
    let direct = |types: &CStr| {
        NSMethodSignature::with_objc_types(types)
            .ok_or(Error::BlockSignature {
                types: types.to_string_lossy().into_owned(),
                what: "does not parse".into(),
            })
            .and_then(|ns| split(&types.to_string_lossy(), &ns, Spelling::Written))
    };
    for shim in SIGNATURES {
        match direct(shim.types) {
            Ok((ret, params)) if shim.ret == ret && shim.params == params => {}
            Ok((ret, params)) => problems.push(format!(
                "{}: the invoke function is ({params:?}) -> {ret:?}, the literal ({:?}) -> {:?}",
                shim.name, shim.params, shim.ret
            )),
            Err(err) => problems.push(format!("{}: {err}", shim.name)),
        }
    }
    let table = super::sdk::BLOCK_PARAMS;
    if !table.is_sorted_by(|a, b| (a.0, a.1, a.2) < (b.0, b.1, b.2)) {
        problems.push("sdk::BLOCK_PARAMS is not sorted by selector, class, index".into());
    }
    for (sel, class_name, index, types) in table {
        if NSMethodSignature::with_objc_types(types).is_none() {
            problems.push(format!(
                "[{} {sel}] block argument {index}: encoding {} does not parse",
                class_name.to_string_lossy(),
                types.to_string_lossy()
            ));
        }
    }
}

/// The function that runs `block`, which takes the block itself first and
/// then the block's arguments.
///
/// # Safety
/// `block` is a live block object.
pub(super) unsafe fn invoke_of(block: Obj) -> *const c_void {
    // SAFETY: every block starts with the fields of `Literal` up to
    // `descriptor`; only `invoke` is read.
    unsafe { core::ptr::addr_of!((*block.cast::<Literal>()).invoke).read() }
}

/// The type encoding `block` was compiled with, when it records one.
///
/// # Safety
/// `block` is a live block object.
pub(super) unsafe fn signature_of<'a>(block: Obj) -> Option<&'a CStr> {
    let literal = block.cast::<Literal>();
    // SAFETY: every block starts with the fields of `Literal` up to
    // `descriptor`; only those are read.
    let (flags, descriptor) = unsafe {
        (
            core::ptr::addr_of!((*literal).flags).read(),
            core::ptr::addr_of!((*literal).descriptor)
                .read()
                .cast::<*const c_char>(),
        )
    };
    if flags & BLOCK_HAS_SIGNATURE == 0 || descriptor.is_null() {
        return None;
    }
    // `reserved` and `size` are pointer-sized; the copy/dispose pair follows
    // when the flags say so; then the signature.
    let index = if flags & BLOCK_HAS_COPY_DISPOSE != 0 {
        4
    } else {
        2
    };
    // SAFETY: the descriptor of a block with a signature has the signature
    // pointer at that index, to a static C string.
    let signature = unsafe { descriptor.add(index).read() };
    // SAFETY: as above.
    (!signature.is_null()).then(|| unsafe { CStr::from_ptr(signature) })
}

/// An encoding as `NSMethodSignature` normalises it (no frame offsets), for messages.
pub(super) fn spelled(ns: &NSMethodSignature) -> String {
    let mut text = ns.method_return_type().0.unwrap_or_default();
    for i in 0..ns.number_of_arguments() {
        text.push_str(&ns.argument_type_at(i).0.unwrap_or_default());
    }
    text
}

/// Checks the block a script passed as block argument `index` of `method`,
/// whose block type the method declares as `expected`: when the block
/// records its own type, the two agree. `object` was just encoded into that
/// slot by [`dynamic::encode`], which refuses anything but a block there.
pub(super) fn check_block_signature(
    method: &str,
    index: usize,
    object: &DynObject,
    expected: &CStr,
) -> Result<()> {
    let live = object.live()?;
    debug_assert!(is_block(rt().class_of(live.as_id())));
    let wrong = |got: String| Error::ArgType {
        method: method.to_owned(),
        index,
        expected: format!("a block of type {}", expected.to_string_lossy()),
        got,
    };
    // SAFETY: a live object `encode` accepted in a block slot: a block.
    let Some(actual) = (unsafe { signature_of(live.as_obj()) }) else {
        return Ok(());
    };
    if actual == expected {
        return Ok(());
    }
    let want = NSMethodSignature::with_objc_types(expected)
        .ok_or_else(|| wrong(format!("a block of type {}", actual.to_string_lossy())))?;
    let want = split(&expected.to_string_lossy(), &want, Spelling::Written)?;
    let actual = actual.to_string_lossy();
    let got = dynamic::method_signature(&actual, |why| {
        wrong(format!(
            "a block whose type encoding {actual:?} is not valid{why}"
        ))
    })?;
    if split(&actual, &got, Spelling::Runtime).is_ok_and(|got| same_shape(&got, &want)) {
        return Ok(());
    }
    Err(wrong(format!("a block of type {}", spelled(&got))))
}

/// Whether a compiled block's signature `got` is the SDK's `want` for it:
/// the same types, except that on x86_64 a compiled `BOOL *` parameter is
/// spelled `*` (what clang emits for any pointer to a signed char), which
/// the SDK table has as the `^B` it means, and a compiled `c` is a `BOOL`
/// or a `char` alike.
fn same_shape(got: &(Enc, Vec<Enc>), want: &(Enc, Vec<Enc>)) -> bool {
    let same = |got: &Enc, want: &Enc| {
        got == want
            || (cfg!(target_arch = "x86_64")
                && ((*want == Enc::Out(Pointee::Bool)
                    && matches!(got, Enc::Buffer(s) if s == "*"))
                    || (*want == CHAR && *got == Enc::Bool)))
    };
    same(&got.0, &want.0)
        && got.1.len() == want.1.len()
        && got.1.iter().zip(&want.1).all(|(g, w)| same(g, w))
}
