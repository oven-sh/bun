use core::ffi::c_void;

use core::cmp::Ordering;
use core::sync::atomic::{AtomicU32, Ordering as AtomicOrdering};

use bun_core::{String as BunString, ZStr};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{CloneSerializer, JSGlobalObject, JSValue, JsCell, JsResult, StringJsc as _};
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

/// The address of a `SocketAddress`, or of an address string in `family`.
fn sockaddr_from_js(
    global: &JSGlobalObject,
    value: JSValue,
    name: &str,
    family: JSValue,
) -> JsResult<sockaddr> {
    if let Some(sa) = value.as_class_ref::<SocketAddress>() {
        return Ok(sa._addr);
    }
    validators::validate_string(global, value, name)?;
    validators::validate_string(global, family, "family")?;
    Ok(SocketAddress::init_from_addr_family(global, value, family)?._addr)
}

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub(crate) struct BlockList {
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
    pub(crate) fn ref_(&self) {
        // SAFETY: `self` is live; `ref_` only touches the atomic `ref_count` field.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::ref_(core::ptr::from_ref(self).cast_mut()) };
    }
    /// # Safety
    /// `this` must point to a live `Self` and the caller must own one ref.
    #[inline]
    pub(crate) unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this) };
    }

    pub(crate) fn constructor() -> *mut Self {
        bun_ptr::RefPtr::new(Self {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            da_rules: JsCell::new(Vec::new()),
            mutex: Mutex::default(),
            estimated_size: AtomicU32::new(0),
            serialize_nonce: {
                let mut n = [0u8; 8];
                bun_boringssl_sys::rand_bytes(&mut n);
                u64::from_ne_bytes(n)
            },
        })
        .into_raw()
    }

    /// May be called from any thread.
    pub(crate) fn estimated_size(&self) -> usize {
        self.estimated_size.load(AtomicOrdering::SeqCst) as usize
            / (self.ref_count.get().max(1) as usize)
    }

    pub(crate) fn is_block_list(value: JsLocal<'_>) -> bool {
        value.to_js().as_::<Self>().is_some()
    }

    pub(crate) fn add_address(
        &self,
        cx: &mut JsScope<'_>,
        address: JsLocal<'_>,
        family: JsLocal<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        let (address_js, mut family_js) = (address.to_js(), family.to_js());
        if family_js.is_undefined() {
            family_js = global.common_strings().ipv4_lower();
        }
        let address = sockaddr_from_js(global, address_js, "address", family_js)?;

        self.add_rule(Rule::Addr(address));
        Ok(())
    }

    pub(crate) fn add_range(
        &self,
        cx: &mut JsScope<'_>,
        start: JsLocal<'_>,
        end: JsLocal<'_>,
        family: JsLocal<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        let (start_js, end_js, mut family_js) = (start.to_js(), end.to_js(), family.to_js());
        if family_js.is_undefined() {
            family_js = global.common_strings().ipv4_lower();
        }
        let start = sockaddr_from_js(global, start_js, "start", family_js)?;
        let end = sockaddr_from_js(global, end_js, "end", family_js)?;
        if let Some(ord) = compare(&start, &end) {
            if ord == Ordering::Greater {
                return Err(global.throw_invalid_argument_value_custom(
                    b"start",
                    start_js,
                    b"must come before end",
                ));
            }
        }
        self.add_rule(Rule::Range { start, end });
        Ok(())
    }

    pub(crate) fn add_subnet(
        &self,
        cx: &mut JsScope<'_>,
        network: JsLocal<'_>,
        prefix: JsLocal<'_>,
        family: JsLocal<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        let (network_js, prefix_js, mut family_js) =
            (network.to_js(), prefix.to_js(), family.to_js());
        if family_js.is_undefined() {
            family_js = global.common_strings().ipv4_lower();
        }
        let network = sockaddr_from_js(global, network_js, "network", family_js)?;
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
        self.add_rule(Rule::Subnet { network, prefix });
        Ok(())
    }

    fn add_rule(&self, rule: Rule) {
        let _guard = self.mutex.lock_guard();
        self.da_rules.with_mut(|r| r.insert(0, rule));
        self.estimated_size.fetch_add(
            u32::try_from(core::mem::size_of::<Rule>()).expect("int cast"),
            AtomicOrdering::Relaxed,
        );
    }

    pub(crate) fn check(
        &self,
        cx: &mut JsScope<'_>,
        address: JsLocal<'_>,
        family: JsLocal<'_>,
    ) -> JsResult<bool> {
        let global = cx.global();
        let (address_js, mut family_js) = (address.to_js(), family.to_js());
        if family_js.is_undefined() {
            family_js = global.common_strings().ipv4_lower();
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
                    return Ok(false);
                }
            }
        };
        Ok(self.check_sockaddr(address))
    }

    pub(crate) fn check_sockaddr(&self, address: &sockaddr) -> bool {
        let _guard = self.mutex.lock_guard();
        for item in self.da_rules.get().iter() {
            match item {
                Rule::Addr(a) => {
                    let Some(order) = compare(address, a) else {
                        continue;
                    };
                    if order.is_eq() {
                        return true;
                    }
                }
                Rule::Range { start, end } => {
                    let Some(os) = compare(address, start) else {
                        continue;
                    };
                    let Some(oe) = compare(address, end) else {
                        continue;
                    };
                    if os.is_ge() && oe.is_le() {
                        return true;
                    }
                }
                Rule::Subnet { network, prefix } => {
                    if let Some(ip_addr) = address.as_v4() {
                        if let Some(subnet_addr) = network.as_sin().map(|s| s.addr) {
                            if *prefix == 32 {
                                if ip_addr == subnet_addr {
                                    return true;
                                } else {
                                    continue;
                                }
                            }
                            if *prefix == 0 {
                                return true;
                            }
                            let one: u32 = 1;
                            let mask_addr: u32 =
                                ((one << (*prefix as u32)) - 1) << (32 - *prefix as u32);
                            let ip_net: u32 = u32::swap_bytes(ip_addr) & mask_addr;
                            let subnet_net: u32 = u32::swap_bytes(subnet_addr) & mask_addr;
                            if ip_net == subnet_net {
                                return true;
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
                                return true;
                            } else {
                                continue;
                            }
                        }
                        if *prefix == 0 {
                            return true;
                        }
                        let one: u128 = 1;
                        let mask_addr = ((one << (*prefix as u32)) - 1) << (128 - *prefix as u32);
                        let ip_net: u128 = ip_addr.swap_bytes() & mask_addr;
                        let subnet_net: u128 = subnet_addr.swap_bytes() & mask_addr;
                        if ip_net == subnet_net {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    pub(crate) fn get_rules(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let _guard = self.mutex.lock_guard();
        let rules = self.da_rules.get();
        // GC must be able to visit
        let array = JSValue::create_empty_array(global, rules.len())?;

        for (i, rule) in rules.iter().enumerate() {
            let s = match rule {
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
            array.put_index(global, i as u32, s.into_js(global)?)?;
        }
        Ok(array)
    }
}

/// Takes the `+1` that [`BlockList__onStructuredCloneDestroy`] releases.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn BlockList__onStructuredCloneSerialize(
    this: &BlockList,
    serializer: &mut CloneSerializer,
) {
    use bun_io::Write as _;
    let _guard = this.mutex.lock_guard();
    this.ref_();
    let addr = std::ptr::from_ref::<BlockList>(this) as usize;
    SERIALIZED_REFS.lock().push((this.serialize_nonce, addr));
    // Deserialize only calls `ref_()` and `to_js_ptr` on `addr`, so `from_ref` provenance is fine.
    _ = serializer.write_int_le(this.serialize_nonce);
}

/// `JSValue::ZERO`: the bytes are not a valid record (the deserializer reports its usual error).
///
/// # Safety
/// `[*ptr, end)` is the unread part of the `SerializedScriptValue`'s buffer.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn BlockList__onStructuredCloneDeserialize(
    global: &JSGlobalObject,
    ptr: &mut *const u8,
    end: *const u8,
) -> JSValue {
    let start = *ptr;
    let total_length: usize = (end as usize) - (start as usize);
    // SAFETY: `[start, end)` spans `total_length` bytes (fn contract).
    let mut r =
        bun_io::FixedBufferStream::new(unsafe { bun_core::ffi::slice(start, total_length) });

    let Ok(nonce) = r.read_int_le::<u64>() else {
        return JSValue::ZERO;
    };

    // SAFETY: `r.pos <= total_length`, so the advanced cursor stays within `[start, end]`.
    *ptr = unsafe { start.add(r.pos) };

    // One SerializedScriptValue can be deserialized many times (BroadcastChannel): a ref per wrapper.
    let this: *mut BlockList = {
        let refs = SERIALIZED_REFS.lock();
        let Some(addr) = refs.iter().find_map(|&(n, a)| (n == nonce).then_some(a)) else {
            return JSValue::ZERO;
        };
        let this = addr as *mut BlockList;
        // SAFETY: the destroy hook removes this entry under the lock before it drops the serialize ref.
        unsafe { (*this).ref_() };
        this
    };
    // SAFETY: the wrapper adopts the ref taken above.
    unsafe { BlockList::to_js_ptr(this, global) }
}

/// `~SerializedScriptValue` releases the ref that [`BlockList__onStructuredCloneSerialize`] took.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn BlockList__onStructuredCloneDestroy(ptr: *mut c_void) {
    let addr = ptr as usize;
    {
        let mut refs = SERIALIZED_REFS.lock();
        if let Some(i) = refs.iter().position(|&(_, a)| a == addr) {
            refs.swap_remove(i);
        }
    }
    // SAFETY: `ptr` is the `&BlockList` serialize was given, kept alive by the ref it took.
    unsafe { BlockList::deref(ptr.cast::<BlockList>()) };
}

pub(crate) enum Rule {
    Addr(sockaddr),
    Range { start: sockaddr, end: sockaddr },
    Subnet { network: sockaddr, prefix: u8 },
}

fn compare(l: &sockaddr, r: &sockaddr) -> Option<Ordering> {
    if let Some(l_4) = l.as_v4() {
        if let Some(r_4) = r.as_v4() {
            return Some(l_4.swap_bytes().cmp(&r_4.swap_bytes()));
        }
    }
    if let (Some(l6), Some(r6)) = (l.as_sin6(), r.as_sin6()) {
        return Some(compare_ipv6(l6, r6));
    }
    None
}

fn compare_ipv6(l: &inet::sockaddr_in6, r: &inet::sockaddr_in6) -> Ordering {
    let l128 = u128::from_ne_bytes(l.addr).swap_bytes();
    let r128 = u128::from_ne_bytes(r.addr).swap_bytes();
    l128.cmp(&r128)
}
