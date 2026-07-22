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
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsResult, Local, Scope, StringJsc as _};
use bun_threading::{Guarded, Mutex};

/// `(serialize_nonce, address)` of `BlockList` instances currently embedded in
/// a live `SerializedScriptValue` (one entry per serialize; removed by
/// `BlockList__onStructuredCloneDestroy`). Only the nonce is written to the
/// wire; deserialize resolves it to an address through this table, so wire
/// bytes from another process (IPC `advanced` mode, `node:v8.deserialize`)
/// cannot smuggle an arbitrary address through tag 251.
static SERIALIZED_REFS: Guarded<Vec<(u64, usize)>> = Guarded::new(Vec::new());

use crate::node::util::validators;
use crate::socket::socket_address::{SocketAddress, sockaddr};

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
    // Intrusive thread-safe refcount.
    // `ref()`/`deref()` (provided by the derive) bump it; hitting zero drops
    // the `Box` via the trait's default destructor.
    ref_count: bun_ptr::ThreadSafeRefCount<BlockList>,
    // R-2: interior mutability so every host_fn takes `&self`. All access is
    // serialized by `mutex` (held across every read and every `with_mut`), so
    // the `JsCell` single-thread invariant is upheld even though `BlockList`
    // can be touched from multiple JS realms via structured clone.
    da_rules: JsCell<Vec<Rule>>,
    mutex: Mutex,

    /// We cannot lock/unlock a mutex
    estimated_size: AtomicU32,

    /// Per-instance random identity; the only token written into the
    /// structured-clone wire. Deserialize maps it back to a live instance via
    /// [`SERIALIZED_REFS`], so the wire never carries a native address and
    /// bytes captured before this instance existed cannot match.
    serialize_nonce: u64,
}

impl BlockList {
    // Trait impl + default destructor (drops the `Box`) provided by
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
    pub fn constructor(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        let ptr = bun_core::heap::into_raw(Box::new(Self {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            da_rules: JsCell::new(Vec::new()),
            mutex: Mutex::default(),
            estimated_size: AtomicU32::new(0),
            serialize_nonce: {
                let mut n = [0u8; 8];
                bun_boringssl_sys::rand_bytes(&mut n);
                u64::from_ne_bytes(n)
            },
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

    #[bun_jsc::host_fn(method, scoped)]
    pub fn add_address<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let [address_js, mut family_js] = frame.scoped_arguments::<2>(scope).ptr;
        let global = scope.unscoped_global();
        if family_js.is_undefined() {
            family_js = scope.local(BunString::static_str("ipv4").to_js(global)?);
        }
        let address = if let Some(sa) = address_js.as_class_ref::<SocketAddress>() {
            sa._addr
        } else {
            validators::validate_string(global, address_js.unscoped(), format_args!("address"))?;
            validators::validate_string(global, family_js.unscoped(), format_args!("family"))?;
            SocketAddress::init_from_addr_family(
                global,
                address_js.unscoped(),
                family_js.unscoped(),
            )?
            ._addr
        };

        let _guard = this.mutex.lock_guard();
        this.da_rules.with_mut(|r| r.insert(0, Rule::Addr(address)));
        this.estimated_size.fetch_add(
            u32::try_from(core::mem::size_of::<Rule>()).expect("int cast"),
            AtomicOrdering::Relaxed,
        );
        Ok(scope.undefined())
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn add_range<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let [start_js, end_js, mut family_js] = frame.scoped_arguments::<3>(scope).ptr;
        let global = scope.unscoped_global();
        if family_js.is_undefined() {
            family_js = scope.local(BunString::static_str("ipv4").to_js(global)?);
        }
        let start = if let Some(sa) = start_js.as_class_ref::<SocketAddress>() {
            sa._addr
        } else {
            validators::validate_string(global, start_js.unscoped(), format_args!("start"))?;
            validators::validate_string(global, family_js.unscoped(), format_args!("family"))?;
            SocketAddress::init_from_addr_family(global, start_js.unscoped(), family_js.unscoped())?
                ._addr
        };
        let end = if let Some(sa) = end_js.as_class_ref::<SocketAddress>() {
            sa._addr
        } else {
            validators::validate_string(global, end_js.unscoped(), format_args!("end"))?;
            validators::validate_string(global, family_js.unscoped(), format_args!("family"))?;
            SocketAddress::init_from_addr_family(global, end_js.unscoped(), family_js.unscoped())?
                ._addr
        };
        if let Some(ord) = _compare(&start, &end) {
            if ord == Ordering::Greater {
                return Err(global.throw_invalid_argument_value_custom(
                    b"start",
                    start_js.unscoped(),
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
        Ok(scope.undefined())
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn add_subnet<'s>(
        this: &Self,
        scope: &mut Scope<'s>,
        frame: &CallFrame,
    ) -> JsResult<Local<'s>> {
        let [network_js, prefix_js, mut family_js] = frame.scoped_arguments::<3>(scope).ptr;
        let global = scope.unscoped_global();
        if family_js.is_undefined() {
            family_js = scope.local(BunString::static_str("ipv4").to_js(global)?);
        }
        let network = if let Some(sa) = network_js.as_class_ref::<SocketAddress>() {
            sa._addr
        } else {
            validators::validate_string(global, network_js.unscoped(), format_args!("network"))?;
            validators::validate_string(global, family_js.unscoped(), format_args!("family"))?;
            SocketAddress::init_from_addr_family(
                global,
                network_js.unscoped(),
                family_js.unscoped(),
            )?
            ._addr
        };
        let mut prefix: u8 = 0;
        let fam = network.family_raw();
        if fam == AF_INET as inet::sa_family_t {
            prefix = u8::try_from(validators::validate_int32(
                global,
                prefix_js.unscoped(),
                format_args!("prefix"),
                Some(0),
                Some(32),
            )?)
            .unwrap();
        } else if fam == AF_INET6 as inet::sa_family_t {
            prefix = u8::try_from(validators::validate_int32(
                global,
                prefix_js.unscoped(),
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
        Ok(scope.undefined())
    }

    #[bun_jsc::host_fn(method, scoped)]
    pub fn check<'s>(this: &Self, scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
        let [address_js, mut family_js] = frame.scoped_arguments::<2>(scope).ptr;
        let global = scope.unscoped_global();
        if family_js.is_undefined() {
            family_js = scope.local(BunString::static_str("ipv4").to_js(global)?);
        }
        let address_val;
        let address: &sockaddr = if let Some(sa) = address_js.as_class_ref::<SocketAddress>() {
            &sa._addr
        } else {
            validators::validate_string(global, address_js.unscoped(), format_args!("address"))?;
            validators::validate_string(global, family_js.unscoped(), format_args!("family"))?;
            match SocketAddress::init_from_addr_family(
                global,
                address_js.unscoped(),
                family_js.unscoped(),
            ) {
                Ok(sa) => {
                    address_val = sa._addr;
                    &address_val
                }
                Err(err) => {
                    debug_assert!(err == bun_jsc::JsError::Thrown);
                    scope.clear_exception();
                    return Ok(scope.local(JSValue::FALSE));
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
                        return Ok(scope.local(JSValue::TRUE));
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
                        return Ok(scope.local(JSValue::TRUE));
                    }
                }
                Rule::Subnet { network, prefix } => {
                    if let Some(ip_addr) = address.as_v4() {
                        if let Some(subnet_addr) = network.as_sin().map(|s| s.addr) {
                            if *prefix == 32 {
                                if ip_addr == subnet_addr {
                                    return Ok(scope.local(JSValue::TRUE));
                                } else {
                                    continue;
                                }
                            }
                            if *prefix == 0 {
                                return Ok(scope.local(JSValue::TRUE));
                            }
                            let one: u32 = 1;
                            let mask_addr: u32 =
                                ((one << (*prefix as u32)) - 1) << (32 - *prefix as u32);
                            let ip_net: u32 = u32::swap_bytes(ip_addr) & mask_addr;
                            let subnet_net: u32 = u32::swap_bytes(subnet_addr) & mask_addr;
                            if ip_net == subnet_net {
                                return Ok(scope.local(JSValue::TRUE));
                            }
                        }
                    }
                    if let Some(net6) = network.as_sin6() {
                        let ip_addr: u128 = if let Some(addr6) = address.as_sin6() {
                            u128::from_ne_bytes(addr6.addr)
                        } else if let Some(ip4) = address.as_v4() {
                            let mut mapped = [0u8; 16];
                            mapped[10] = 255;
                            mapped[11] = 255;
                            mapped[12..16].copy_from_slice(&ip4.to_ne_bytes());
                            u128::from_ne_bytes(mapped)
                        } else {
                            continue;
                        };
                        let subnet_addr: u128 = u128::from_ne_bytes(net6.addr);
                        if *prefix == 128 {
                            if ip_addr == subnet_addr {
                                return Ok(scope.local(JSValue::TRUE));
                            } else {
                                continue;
                            }
                        }
                        if *prefix == 0 {
                            return Ok(scope.local(JSValue::TRUE));
                        }
                        let one: u128 = 1;
                        let mask_addr = ((one << (*prefix as u32)) - 1) << (128 - *prefix as u32);
                        let ip_net: u128 = ip_addr.swap_bytes() & mask_addr;
                        let subnet_net: u128 = subnet_addr.swap_bytes() & mask_addr;
                        if ip_net == subnet_net {
                            return Ok(scope.local(JSValue::TRUE));
                        }
                    }
                }
            }
        }
        Ok(scope.local(JSValue::FALSE))
    }

    #[bun_jsc::host_fn(getter, scoped)]
    pub fn rules<'s>(this: &Self, scope: &mut Scope<'s>) -> JsResult<Local<'s>> {
        let global = scope.unscoped_global();
        let _guard = this.mutex.lock_guard();
        let rules = this.da_rules.get();
        // GC must be able to visit
        let array = scope.new_array(rules.len())?;

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
            array
                .unscoped()
                .put_index(global, i as u32, s.transfer_to_js(global)?)?;
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
        let addr = std::ptr::from_ref::<Self>(this) as usize;
        SERIALIZED_REFS.lock().push((this.serialize_nonce, addr));
        let mut writer = StructuredCloneWriter {
            ctx,
            impl_: write_bytes,
        };
        // The writer is infallible, so no `?` needed.
        // Only the nonce is serialized; deserialize maps it back to `*mut Self`
        // through `SERIALIZED_REFS` and never forms `&mut Self` (only `ref_()` +
        // `to_js_ptr`, both `&self`/raw-ptr), so `from_ref` provenance is fine.
        _ = writer.write_int_le(this.serialize_nonce);
    }

    // C++ codegen calls this with a live `*mut *mut u8` cursor and end pointer; the
    // signature is fixed by `generate-classes.ts`, so the deref is documented with
    // the SAFETY comment below.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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
        // SAFETY: `*ptr` through `end` is the contiguous C++-owned deserialization
        // buffer (see above); `total_length = end - *ptr`, so the resulting slice
        // is exactly that buffer and stays valid for the lifetime of `r`.
        let mut r =
            bun_io::FixedBufferStream::new(unsafe { bun_core::ffi::slice(*ptr, total_length) });

        let nonce = match r.read_int_le::<u64>() {
            Ok(n) => n,
            Err(_) => {
                return Err(global.throw(format_args!(
                    "BlockList.onStructuredCloneDeserialize failed"
                )));
            }
        };

        // Advance the pointer by the number of bytes consumed
        // SAFETY: `r.pos <= total_length` (`read_exact` bounds-checks via `checked_add`).
        *ptr = unsafe { (*ptr).add(r.pos) };

        // A single SerializedScriptValue can be deserialized multiple times
        // (e.g. BroadcastChannel fan-out), so each wrapper must own its own ref
        // instead of adopting the one taken in serialize. The serialize ref is
        // what keeps the backing alive while its entry sits in `SERIALIZED_REFS`
        // and is released by `~SerializedScriptValue` via the destroy hook below.
        let this: *mut Self = {
            let refs = SERIALIZED_REFS.lock();
            let Some(addr) = refs.iter().find_map(|&(n, a)| (n == nonce).then_some(a)) else {
                return Err(global.throw(format_args!(
                    "BlockList.onStructuredCloneDeserialize failed"
                )));
            };
            let this = addr as *mut Self;
            // SAFETY: the entry was pushed by `on_structured_clone_serialize`
            // from a live `*mut Self` whose ref was bumped at serialize time
            // (paired `ref_()`/`deref()`); that ref is only released by the
            // destroy hook after it takes this lock and removes the entry, so
            // `this` is live while the guard is held and we ref it first.
            unsafe { (*this).ref_() };
            this
        };
        // SAFETY: ownership of the ref taken above transfers to the C++ wrapper
        // (released via `finalize` → `deref`). `to_js_ptr` is the
        // `#[bun_jsc::JsClass]`-generated `${T}__create` shim.
        Ok(unsafe { Self::to_js_ptr(this, global) })
    }
}

bun_jsc::jsc_host_abi! {
    /// Called from `~SerializedScriptValue` for each BlockList pointer that was
    /// written into the wire buffer. Releases the `+1` taken by
    /// [`BlockList::on_structured_clone_serialize`].
    #[unsafe(no_mangle)]
    pub(crate) unsafe fn BlockList__onStructuredCloneDestroy(ptr: *mut c_void) -> () {
        let addr = ptr as usize;
        {
            let mut refs = SERIALIZED_REFS.lock();
            if let Some(i) = refs.iter().position(|&(_, a)| a == addr) {
                refs.swap_remove(i);
            }
        }
        // SAFETY: `ptr` is the same `*mut BlockList` passed to
        // `on_structured_clone_serialize`; it stayed alive because that path
        // bumped the refcount. Dropping that ref here may free the box.
        unsafe { BlockList::deref(ptr.cast::<BlockList>()) };
    }
}

pub(crate) enum Rule {
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
