use core::ffi::c_void;

// ─── non-JSC helpers (real) ───────────────────────────────────────────────
// `Rule` and the IP-compare helpers depend on `sockaddr` from the sibling
// `socket_address` module (lives in `crate::socket`, not `super::`), so they
// stay gated below. Only the structured-clone byte-shuffling is JSC-free and
// dependency-free.

struct StructuredCloneWriter {
    ctx: *mut c_void,
    // TODO(port): callconv(jsc.conv) — see note on `on_structured_clone_serialize`.
    impl_: unsafe extern "C" fn(*mut c_void, *const u8, u32),
}

impl StructuredCloneWriter {
    fn write(&self, bytes: &[u8]) -> usize {
        // SAFETY: `ctx` and `impl_` were supplied together by the C++
        // SerializedScriptValue writer; the callback only reads `len` bytes
        // from `ptr`, both of which we derive from a single `&[u8]`.
        unsafe { (self.impl_)(self.ctx, bytes.as_ptr(), bytes.len() as u32) };
        bytes.len()
    }

    fn write_int_le(&self, v: usize) {
        let bytes = v.to_le_bytes();
        self.write(&bytes);
    }
}

fn read_int_le_usize(buf: &[u8], pos: &mut usize) -> Option<usize> {
    const N: usize = core::mem::size_of::<usize>();
    if buf.len() - *pos < N {
        return None;
    }
    let mut arr = [0u8; N];
    arr.copy_from_slice(&buf[*pos..*pos + N]);
    *pos += N;
    Some(usize::from_le_bytes(arr))
}

// ─── JsClass payload + host fns ───────────────────────────────────────────
// `BlockList` is the `m_ctx` payload for a `.classes.ts` wrapper; every method
// is a `#[bun_jsc::host_fn]` and the struct itself carries `#[bun_jsc::JsClass]`.

use core::cmp::Ordering;
use core::sync::atomic::{AtomicU32, Ordering as AtomicOrdering};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};
use bun_str::{String as BunString, ZStr};
use bun_threading::Mutex;

use crate::socket::socket_address::{sockaddr, SocketAddress};
use crate::node::util::validators;

// TODO(port): move to <area>_sys — AF_* constants come from translated-c-headers
use crate::socket::socket_address::inet::{self, AF_INET, AF_INET6};

/// `&ZStr` → `&str` for `format_args!`. IP presentation strings and AF family
/// names are ASCII by construction (`inet_ntop` output / static literals).
#[inline]
fn z(s: &ZStr) -> &str {
    // SAFETY: callers pass ASCII-only `ZStr`s (see above).
    unsafe { core::str::from_utf8_unchecked(s.as_bytes()) }
}

/// `.classes.ts`-backed payload (`m_ctx`) for `JSBlockList`.
/// `fromJS` / `toJS` are provided by the codegen via `#[bun_jsc::JsClass]`.
#[bun_jsc::JsClass]
pub struct BlockList {
    // Intrusive thread-safe refcount (Zig: `bun.ptr.ThreadSafeRefCount`).
    // `bun_ptr::IntrusiveArc<BlockList>` wraps this; `ref()`/`deref()` bump it,
    // `deref()` hitting zero calls `deinit` (here: drops the `Box`).
    ref_count: AtomicU32,
    // LIFETIMES.tsv: JSC_BORROW → `&JSGlobalObject`. Stored raw because this
    // struct is a heap-allocated `m_ctx` payload recovered from C++ via
    // `*mut Self`; a borrowed lifetime param cannot be threaded through that.
    // TODO(port): lifetime — field is write-only (assigned in constructor,
    // never read; `deinit` ignores it).
    global_this: *const JSGlobalObject,
    da_rules: Vec<Rule>,
    mutex: Mutex,

    /// We cannot lock/unlock a mutex
    estimated_size: AtomicU32,
}

impl BlockList {
    // Zig: `bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{})`
    // → `bun_ptr::IntrusiveArc<Self>` semantics. `new` boxes + leaks to raw.
    pub fn ref_(&self) {
        self.ref_count.fetch_add(1, AtomicOrdering::AcqRel);
    }
    pub fn deref(this: *mut Self) {
        // SAFETY: `this` is a live `Box::into_raw` pointer with ref_count >= 1.
        unsafe {
            if (*this).ref_count.fetch_sub(1, AtomicOrdering::AcqRel) == 1 {
                Self::deinit(this);
            }
        }
    }

    // NOTE: no `#[bun_jsc::host_fn]` — the `#[bun_jsc::JsClass]` derive emits
    // the `${T}Class__construct` C-ABI shim that calls `<Self>::constructor`.
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        let ptr = Box::into_raw(Box::new(Self {
            ref_count: AtomicU32::new(1),
            global_this: global as *const _,
            da_rules: Vec::new(),
            mutex: Mutex::default(),
            estimated_size: AtomicU32::new(0),
        }));
        Ok(ptr)
    }

    /// May be called from any thread.
    pub fn estimated_size(&self) -> usize {
        (core::mem::size_of::<Self>()
            + self.estimated_size.load(AtomicOrdering::SeqCst) as usize)
            / (self.ref_count.load(AtomicOrdering::Acquire).max(1) as usize)
    }

    pub fn finalize(this: *mut Self) {
        Self::deref(this);
    }

    fn deinit(this: *mut Self) {
        // `da_rules` is dropped by `Box` drop; `bun.destroy(this)` → `Box::from_raw`.
        // SAFETY: called exactly once when ref_count hits zero on a `Box::into_raw` pointer.
        unsafe { drop(Box::from_raw(this)) };
    }

    // NOTE: no `#[bun_jsc::host_fn]` — receiver-less assoc fns aren't supported
    // by the Free-kind shim (it emits a bare `fn_name(...)` call). The
    // `.classes.ts` codegen owns the static-method link name and calls
    // `<Self>::is_block_list` directly.
    pub fn is_block_list(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let [value] = frame.arguments_as_array::<1>();
        Ok(JSValue::from(value.as_::<Self>().is_some()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_address(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [address_js, mut family_js] = frame.arguments_as_array::<2>();
        if family_js.is_undefined() {
            family_js = BunString::static_str("ipv4").to_js(global)?;
        }
        let address = if let Some(sa) = address_js.as_::<SocketAddress>() {
            // SAFETY: `as_` returns a live `*mut SocketAddress` (m_ctx payload).
            unsafe { (*sa)._addr }
        } else {
            validators::validate_string(global, address_js, format_args!("address"))?;
            validators::validate_string(global, family_js, format_args!("family"))?;
            SocketAddress::init_from_addr_family(global, address_js, family_js)?._addr
        };

        let _guard = this.mutex.lock();
        this.da_rules.insert(0, Rule::Addr(address));
        this.estimated_size.fetch_add(
            u32::try_from(core::mem::size_of::<Rule>()).unwrap(),
            AtomicOrdering::Relaxed,
        );
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_range(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [start_js, end_js, mut family_js] = frame.arguments_as_array::<3>();
        if family_js.is_undefined() {
            family_js = BunString::static_str("ipv4").to_js(global)?;
        }
        let start = if let Some(sa) = start_js.as_::<SocketAddress>() {
            // SAFETY: `as_` returns a live `*mut SocketAddress` (m_ctx payload).
            unsafe { (*sa)._addr }
        } else {
            validators::validate_string(global, start_js, format_args!("start"))?;
            validators::validate_string(global, family_js, format_args!("family"))?;
            SocketAddress::init_from_addr_family(global, start_js, family_js)?._addr
        };
        let end = if let Some(sa) = end_js.as_::<SocketAddress>() {
            // SAFETY: `as_` returns a live `*mut SocketAddress` (m_ctx payload).
            unsafe { (*sa)._addr }
        } else {
            validators::validate_string(global, end_js, format_args!("end"))?;
            validators::validate_string(global, family_js, format_args!("family"))?;
            SocketAddress::init_from_addr_family(global, end_js, family_js)?._addr
        };
        if let Some(ord) = _compare(&start, &end) {
            if ord == Ordering::Greater {
                return Err(global.throw_invalid_argument_value_custom(
                    b"start",
                    start_js,
                    b"must come before end",
                ));
            }
        }
        let _guard = this.mutex.lock();
        this.da_rules.insert(0, Rule::Range { start, end });
        this.estimated_size.fetch_add(
            u32::try_from(core::mem::size_of::<Rule>()).unwrap(),
            AtomicOrdering::Relaxed,
        );
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_subnet(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [network_js, prefix_js, mut family_js] = frame.arguments_as_array::<3>();
        if family_js.is_undefined() {
            family_js = BunString::static_str("ipv4").to_js(global)?;
        }
        let network = if let Some(sa) = network_js.as_::<SocketAddress>() {
            // SAFETY: `as_` returns a live `*mut SocketAddress` (m_ctx payload).
            unsafe { (*sa)._addr }
        } else {
            validators::validate_string(global, network_js, format_args!("network"))?;
            validators::validate_string(global, family_js, format_args!("family"))?;
            SocketAddress::init_from_addr_family(global, network_js, family_js)?._addr
        };
        let mut prefix: u8 = 0;
        // SAFETY: `sin.family` is at the same offset for both union variants.
        let fam = unsafe { network.sin.family };
        if fam == AF_INET as inet::sa_family_t {
            prefix = u8::try_from(validators::validate_int32(
                global, prefix_js, format_args!("prefix"), Some(0), Some(32),
            )?)
            .unwrap();
        } else if fam == AF_INET6 as inet::sa_family_t {
            prefix = u8::try_from(validators::validate_int32(
                global, prefix_js, format_args!("prefix"), Some(0), Some(128),
            )?)
            .unwrap();
        }
        let _guard = this.mutex.lock();
        this.da_rules.insert(0, Rule::Subnet { network, prefix });
        this.estimated_size.fetch_add(
            u32::try_from(core::mem::size_of::<Rule>()).unwrap(),
            AtomicOrdering::Relaxed,
        );
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn check(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [address_js, mut family_js] = frame.arguments_as_array::<2>();
        if family_js.is_undefined() {
            family_js = BunString::static_str("ipv4").to_js(global)?;
        }
        let address_val;
        let address: &sockaddr = if let Some(sa) = address_js.as_::<SocketAddress>() {
            // SAFETY: `as_` returns a live `*mut SocketAddress` (m_ctx payload);
            // borrow is valid for the duration of this call (no GC yield).
            unsafe { &(*sa)._addr }
        } else {
            validators::validate_string(global, address_js, format_args!("address"))?;
            validators::validate_string(global, family_js, format_args!("family"))?;
            match SocketAddress::init_from_addr_family(global, address_js, family_js) {
                Ok(sa) => {
                    address_val = sa._addr;
                    &address_val
                }
                Err(err) => {
                    debug_assert!(err == bun_jsc::JsError::Thrown);
                    global.clear_exception();
                    return Ok(JSValue::FALSE);
                }
            }
        };
        let _guard = this.mutex.lock();
        for item in this.da_rules.iter() {
            match item {
                Rule::Addr(a) => {
                    let Some(order) = _compare(address, a) else { continue };
                    if order.is_eq() {
                        return Ok(JSValue::TRUE);
                    }
                }
                Rule::Range { start, end } => {
                    let Some(os) = _compare(address, start) else { continue };
                    let Some(oe) = _compare(address, end) else { continue };
                    if os.is_ge() && oe.is_le() {
                        return Ok(JSValue::TRUE);
                    }
                }
                Rule::Subnet { network, prefix } => {
                    if let Some(ip_addr) = address.as_v4() {
                        if let Some(subnet_addr) = network.as_v4() {
                            if *prefix == 32 {
                                if ip_addr == subnet_addr {
                                    return Ok(JSValue::TRUE);
                                } else {
                                    continue;
                                }
                            }
                            let one: u32 = 1;
                            let mask_addr: u32 =
                                ((one << (*prefix as u32)) - 1) << (32 - *prefix as u32);
                            let ip_net: u32 = u32::swap_bytes(ip_addr) & mask_addr;
                            let subnet_net: u32 = u32::swap_bytes(subnet_addr) & mask_addr;
                            if ip_net == subnet_net {
                                return Ok(JSValue::TRUE);
                            }
                        }
                    }
                    // SAFETY: `sin.family` is at the same offset for both union variants.
                    if unsafe { address.sin.family } == AF_INET6 as inet::sa_family_t
                        && unsafe { network.sin.family } == AF_INET6 as inet::sa_family_t
                    {
                        // SAFETY: family == INET6 guarantees `sin6` variant is active;
                        // `sin6.addr` is `[u8; 16]`, all-bytes valid for u128.
                        let ip_addr: u128 = u128::from_ne_bytes(unsafe { address.sin6.addr });
                        let subnet_addr: u128 = u128::from_ne_bytes(unsafe { network.sin6.addr });
                        if *prefix == 128 {
                            if ip_addr == subnet_addr {
                                return Ok(JSValue::TRUE);
                            } else {
                                continue;
                            }
                        }
                        let one: u128 = 1;
                        let mask_addr =
                            ((one << (*prefix as u32)) - 1) << (128 - *prefix as u32);
                        let ip_net: u128 = ip_addr.swap_bytes() & mask_addr;
                        let subnet_net: u128 = subnet_addr.swap_bytes() & mask_addr;
                        if ip_net == subnet_net {
                            return Ok(JSValue::TRUE);
                        }
                    }
                }
            }
        }
        Ok(JSValue::FALSE)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn rules(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let _guard = this.mutex.lock();
        // GC must be able to visit
        let array = JSValue::create_empty_array(global, this.da_rules.len())?;

        for (i, rule) in this.da_rules.iter().enumerate() {
            let mut s = match rule {
                Rule::Addr(a) => {
                    let mut buf = [0u8; inet::INET6_ADDRSTRLEN as usize];
                    BunString::create_format(format_args!(
                        "Address: {} {}",
                        z(a.family().upper()),
                        z(a.fmt(&mut buf)),
                    ))
                }
                Rule::Range { start, end } => {
                    let mut buf_s = [0u8; inet::INET6_ADDRSTRLEN as usize];
                    let mut buf_e = [0u8; inet::INET6_ADDRSTRLEN as usize];
                    BunString::create_format(format_args!(
                        "Range: {} {}-{}",
                        z(start.family().upper()),
                        z(start.fmt(&mut buf_s)),
                        z(end.fmt(&mut buf_e)),
                    ))
                }
                Rule::Subnet { network, prefix } => {
                    let mut buf = [0u8; inet::INET6_ADDRSTRLEN as usize];
                    BunString::create_format(format_args!(
                        "Subnet: {} {}/{}",
                        z(network.family().upper()),
                        z(network.fmt(&mut buf)),
                        prefix,
                    ))
                }
            };
            array.put_index(global, i as u32, s.transfer_to_js(global)?)?;
        }
        Ok(array)
    }

    pub fn on_structured_clone_serialize(
        this: &mut Self,
        _global: &JSGlobalObject,
        ctx: *mut c_void,
        // TODO(port): callconv(jsc.conv) — `extern "C"` is correct on non-Windows-x64;
        // on Windows-x64 this must be `extern "sysv64"`. Needs `#[bun_jsc::host_call]` typedef.
        write_bytes: unsafe extern "C" fn(*mut c_void, *const u8, u32),
    ) {
        let _guard = this.mutex.lock();
        this.ref_();
        let writer = StructuredCloneWriter { ctx, impl_: write_bytes };
        // Error = `!` (Zig: `error{}`), so no `?` needed.
        writer.write_int_le((this as *mut Self) as usize);
    }

    pub fn on_structured_clone_deserialize(
        global: &JSGlobalObject,
        ptr: *mut *mut u8,
        end: *const u8,
    ) -> JsResult<JSValue> {
        // SAFETY: `*ptr` and `end` bound a contiguous byte buffer owned by the
        // caller (C++ SerializedScriptValue); `end >= *ptr`. `ptr` itself is a
        // non-null out-param the caller expects us to advance.
        let ptr = unsafe { &mut *ptr };
        let total_length: usize = (end as usize) - (*ptr as usize);
        let buf = unsafe { core::slice::from_raw_parts(*ptr, total_length) };
        let mut pos: usize = 0;

        let int = match read_int_le_usize(buf, &mut pos) {
            Some(v) => v,
            None => {
                return Err(global.throw(format_args!(
                    "BlockList.onStructuredCloneDeserialize failed"
                )));
            }
        };

        // Advance the pointer by the number of bytes consumed
        // SAFETY: `pos <= total_length` by construction of `read_int_le_usize`.
        *ptr = unsafe { (*ptr).add(pos) };

        let this: *mut Self = int as *mut Self;
        // A single SerializedScriptValue can be deserialized multiple times
        // (e.g. BroadcastChannel fan-out), so each wrapper must own its own ref
        // instead of adopting the one taken in serialize. The serialize ref is
        // what keeps the backing alive while the pointer sits in the byte buffer;
        // SerializedScriptValue has no destroy hook for Bun-native tags, so that
        // ref is retained until a buffer-level deref exists (preferable to UAF).
        // SAFETY: `int` was produced by `on_structured_clone_serialize` from a
        // live `*mut Self` whose ref was bumped at serialize time. Ownership of
        // one ref transfers to the C++ wrapper (released via `finalize` → `deref`).
        // `to_js_ptr` is the `#[bun_jsc::JsClass]`-generated `${T}__create` shim.
        unsafe {
            (*this).ref_();
            Ok(Self::to_js_ptr(this, global))
        }
    }
}

pub enum Rule {
    Addr(sockaddr),
    Range { start: sockaddr, end: sockaddr },
    Subnet { network: sockaddr, prefix: u8 },
}

fn _compare(l: &sockaddr, r: &sockaddr) -> Option<Ordering> {
    if let Some(l_4) = l.as_v4() {
        if let Some(r_4) = r.as_v4() {
            return Some(l_4.swap_bytes().cmp(&r_4.swap_bytes()));
        }
    }
    // SAFETY: `sin.family` is at the same offset for both union variants.
    if unsafe { l.sin.family } == AF_INET6 as inet::sa_family_t
        && unsafe { r.sin.family } == AF_INET6 as inet::sa_family_t
    {
        // SAFETY: family == INET6 guarantees `sin6` variant is active.
        return Some(_compare_ipv6(unsafe { &l.sin6 }, unsafe { &r.sin6 }));
    }
    None
}

fn _compare_ipv6(l: &inet::sockaddr_in6, r: &inet::sockaddr_in6) -> Ordering {
    let l128 = u128::from_ne_bytes(l.addr).swap_bytes();
    let r128 = u128::from_ne_bytes(r.addr).swap_bytes();
    l128.cmp(&r128)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/net/BlockList.zig (256 lines)
//   confidence: high
//   notes:      JsClass m_ctx payload w/ intrusive atomic refcount; jsc.conv callback ABI on Windows-x64 still needs `#[bun_jsc::host_call]` typedef; sockaddr union field access (.sin/.sin6) per sibling SocketAddress port
// ──────────────────────────────────────────────────────────────────────────
