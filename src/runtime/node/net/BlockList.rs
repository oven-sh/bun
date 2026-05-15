use core::ffi::c_void;

// ─── non-JSC helpers (real) ───────────────────────────────────────────────
// `Rule` and the IP-compare helpers depend on `sockaddr` from the sibling
// `socket_address` module (lives in `crate::socket`, not `super::`), so they
// stay gated below. Only the structured-clone byte-shuffling is JSC-free and
// dependency-free.

struct StructuredCloneWriter {
    ctx: *mut c_void,
    // callconv(jsc.conv) → codegen `WriteBytesFn` typedef (cfg-splits to
    // `"sysv64"` on Windows-x64).
    impl_: crate::generated_classes::WriteBytesFn,
}

impl bun_io::Write for StructuredCloneWriter {
    #[inline]
    fn write_all(&mut self, bytes: &[u8]) -> bun_io::Result<()> {
        // SAFETY: `ctx` and `impl_` were supplied together by the C++
        // SerializedScriptValue writer; the callback only reads `len` bytes
        // from `ptr`, both of which we derive from a single `&[u8]`.
        unsafe { (self.impl_)(self.ctx, bytes.as_ptr(), bytes.len() as u32) };
        Ok(())
    }
}

// ─── JsClass payload + host fns ───────────────────────────────────────────
// `BlockList` is the `m_ctx` payload for a `.classes.ts` wrapper; every method
// is a `#[bun_jsc::host_fn]` and the struct itself carries `#[bun_jsc::JsClass]`.

use core::cmp::Ordering;
use core::sync::atomic::{AtomicU32, Ordering as AtomicOrdering};

use bun_core::{String as BunString, ZStr};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsResult, StringJsc as _};
use bun_threading::Mutex;

use crate::node::util::validators;
use crate::socket::socket_address::{SocketAddress, sockaddr};

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
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct BlockList {
    // Intrusive thread-safe refcount (Zig: `bun.ptr.ThreadSafeRefCount`).
    // `ref()`/`deref()` (provided by the derive) bump it; hitting zero drops
    // the `Box` via the trait's default destructor.
    ref_count: bun_ptr::ThreadSafeRefCount<BlockList>,
    // LIFETIMES.tsv: JSC_BORROW → `&JSGlobalObject`. Stored raw because this
    // struct is a heap-allocated `m_ctx` payload recovered from C++ via
    // `*mut Self`; a borrowed lifetime param cannot be threaded through that.
    // TODO(port): lifetime — field is write-only (assigned in constructor,
    // never read; `deinit` ignores it).
    global_this: *const JSGlobalObject,
    // R-2: interior mutability so every host_fn takes `&self`. All access is
    // serialized by `mutex` (held across every read and every `with_mut`), so
    // the `JsCell` single-thread invariant is upheld even though `BlockList`
    // can be touched from multiple JS realms via structured clone.
    da_rules: JsCell<Vec<Rule>>,
    mutex: Mutex,

    /// We cannot lock/unlock a mutex
    estimated_size: AtomicU32,
}

impl BlockList {
    // Zig: `bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{})`
    // → trait impl + default destructor (drops the `Box`) provided by
    // `#[derive(ThreadSafeRefCounted)]`; inherent forwarders below.
    #[inline]
    pub fn ref_(&self) {
        // SAFETY: `self` is live; `ref_` only touches the atomic `ref_count` field.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::ref_(core::ptr::from_ref(self).cast_mut()) };
    }
    /// # Safety
    /// `this` must point to a live `Self` and the caller must own one ref.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this) };
    }

    // NOTE: no `#[bun_jsc::host_fn]` — the `#[bun_jsc::JsClass]` derive emits
    // the `${T}Class__construct` C-ABI shim that calls `<Self>::constructor`.
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        let ptr = bun_core::heap::into_raw(Box::new(Self {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            global_this: std::ptr::from_ref(global),
            da_rules: JsCell::new(Vec::new()),
            mutex: Mutex::default(),
            estimated_size: AtomicU32::new(0),
        }));
        Ok(ptr)
    }

    /// May be called from any thread.
    pub fn estimated_size(&self) -> usize {
        (core::mem::size_of::<Self>() + self.estimated_size.load(AtomicOrdering::SeqCst) as usize)
            / (self.ref_count.get().max(1) as usize)
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
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
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [address_js, mut family_js] = frame.arguments_as_array::<2>();
        if family_js.is_undefined() {
            family_js = BunString::static_str("ipv4").to_js(global)?;
        }
        let address = if let Some(sa) = address_js.as_class_ref::<SocketAddress>() {
            sa._addr
        } else {
            validators::validate_string(global, address_js, format_args!("address"))?;
            validators::validate_string(global, family_js, format_args!("family"))?;
            SocketAddress::init_from_addr_family(global, address_js, family_js)?._addr
        };

        let _guard = this.mutex.lock_guard();
        this.da_rules.with_mut(|r| r.insert(0, Rule::Addr(address)));
        this.estimated_size.fetch_add(
            u32::try_from(core::mem::size_of::<Rule>()).expect("int cast"),
            AtomicOrdering::Relaxed,
        );
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_range(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let [start_js, end_js, mut family_js] = frame.arguments_as_array::<3>();
        if family_js.is_undefined() {
            family_js = BunString::static_str("ipv4").to_js(global)?;
        }
        let start = if let Some(sa) = start_js.as_class_ref::<SocketAddress>() {
            sa._addr
        } else {
            validators::validate_string(global, start_js, format_args!("start"))?;
            validators::validate_string(global, family_js, format_args!("family"))?;
            SocketAddress::init_from_addr_family(global, start_js, family_js)?._addr
        };
        let end = if let Some(sa) = end_js.as_class_ref::<SocketAddress>() {
            sa._addr
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
        let _guard = this.mutex.lock_guard();
        this.da_rules
            .with_mut(|r| r.insert(0, Rule::Range { start, end }));
        this.estimated_size.fetch_add(
            u32::try_from(core::mem::size_of::<Rule>()).expect("int cast"),
            AtomicOrdering::Relaxed,
        );
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_subnet(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [network_js, prefix_js, mut family_js] = frame.arguments_as_array::<3>();
        if family_js.is_undefined() {
            family_js = BunString::static_str("ipv4").to_js(global)?;
        }
        let network = if let Some(sa) = network_js.as_class_ref::<SocketAddress>() {
            sa._addr
        } else {
            validators::validate_string(global, network_js, format_args!("network"))?;
            validators::validate_string(global, family_js, format_args!("family"))?;
            SocketAddress::init_from_addr_family(global, network_js, family_js)?._addr
        };
        let mut prefix: u8 = 0;
        let fam = network.family_raw();
        if fam == AF_INET as inet::sa_family_t {
            prefix = u8::try_from(validators::validate_int32(
                global,
                prefix_js,
                format_args!("prefix"),
                Some(0),
                Some(32),
            )?)
            .unwrap();
        } else if fam == AF_INET6 as inet::sa_family_t {
            prefix = u8::try_from(validators::validate_int32(
                global,
                prefix_js,
                format_args!("prefix"),
                Some(0),
                Some(128),
            )?)
            .unwrap();
        }
        let _guard = this.mutex.lock_guard();
        this.da_rules
            .with_mut(|r| r.insert(0, Rule::Subnet { network, prefix }));
        this.estimated_size.fetch_add(
            u32::try_from(core::mem::size_of::<Rule>()).expect("int cast"),
            AtomicOrdering::Relaxed,
        );
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn check(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let [address_js, mut family_js] = frame.arguments_as_array::<2>();
        if family_js.is_undefined() {
            family_js = BunString::static_str("ipv4").to_js(global)?;
        }
        let address_val;
        let address: &sockaddr = if let Some(sa) = address_js.as_class_ref::<SocketAddress>() {
            &sa._addr
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
        let _guard = this.mutex.lock_guard();
        for item in this.da_rules.get().iter() {
            match item {
                Rule::Addr(a) => {
                    let Some(order) = _compare(address, a) else {
                        continue;
                    };
                    if order.is_eq() {
                        return Ok(JSValue::TRUE);
                    }
                }
                Rule::Range { start, end } => {
                    let Some(os) = _compare(address, start) else {
                        continue;
                    };
                    let Some(oe) = _compare(address, end) else {
                        continue;
                    };
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
                    if let (Some(addr6), Some(net6)) = (address.as_sin6(), network.as_sin6()) {
                        let ip_addr: u128 = u128::from_ne_bytes(addr6.addr);
                        let subnet_addr: u128 = u128::from_ne_bytes(net6.addr);
                        if *prefix == 128 {
                            if ip_addr == subnet_addr {
                                return Ok(JSValue::TRUE);
                            } else {
                                continue;
                            }
                        }
                        let one: u128 = 1;
                        let mask_addr = ((one << (*prefix as u32)) - 1) << (128 - *prefix as u32);
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
        let _guard = this.mutex.lock_guard();
        let rules = this.da_rules.get();
        // GC must be able to visit
        let array = JSValue::create_empty_array(global, rules.len())?;

        for (i, rule) in rules.iter().enumerate() {
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
        this: &Self,
        _global: &JSGlobalObject,
        ctx: *mut c_void,
        // codegen `WriteBytesFn` typedef (jsc.conv).
        write_bytes: crate::generated_classes::WriteBytesFn,
    ) {
        use bun_io::Write as _;
        let _guard = this.mutex.lock_guard();
        this.ref_();
        let mut writer = StructuredCloneWriter {
            ctx,
            impl_: write_bytes,
        };
        // Error = `!` (Zig: `error{}`), so no `?` needed.
        // Only the address is serialized; deserialize re-derives `*mut Self`
        // via int→ptr cast and never forms `&mut Self` (only `ref_()` +
        // `to_js_ptr`, both `&self`/raw-ptr), so `from_ref` provenance is fine.
        _ = writer.write_int_le(std::ptr::from_ref::<Self>(this) as usize);
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
        let mut r =
            bun_io::FixedBufferStream::new(unsafe { bun_core::ffi::slice(*ptr, total_length) });

        let int = match r.read_int_le::<usize>() {
            Ok(v) => v,
            Err(_) => {
                return Err(global.throw(format_args!(
                    "BlockList.onStructuredCloneDeserialize failed"
                )));
            }
        };

        // Advance the pointer by the number of bytes consumed
        // SAFETY: `r.pos <= total_length` (`read_exact` bounds-checks via `checked_add`).
        *ptr = unsafe { (*ptr).add(r.pos) };

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
    if let (Some(l6), Some(r6)) = (l.as_sin6(), r.as_sin6()) {
        return Some(_compare_ipv6(l6, r6));
    }
    None
}

fn _compare_ipv6(l: &inet::sockaddr_in6, r: &inet::sockaddr_in6) -> Ordering {
    let l128 = u128::from_ne_bytes(l.addr).swap_bytes();
    let r128 = u128::from_ne_bytes(r.addr).swap_bytes();
    l128.cmp(&r128)
}

// ported from: src/runtime/node/net/BlockList.zig
