//! libffi, as macOS ships it in `/usr/lib`: the calling convention work for
//! a message whose argument and return types the bridge has laid out, so
//! `objc_msgSend` (or a block's `invoke`) is called directly instead of
//! through an `NSInvocation`. One call interface ([`Prepared`]) is built per
//! distinct shape of call and kept for the life of the process. Every type
//! encoding the bridge accepts as an argument or return has an `ffi_type`
//! here (a struct only when libffi sizes it as [`StructType`] does, which
//! [`verify`] checks for the shapes the frameworks use), so the
//! `NSInvocation` send path runs only when
//! `BUN_FEATURE_FLAG_DISABLE_OBJC_LIBFFI` turns this one off: an A/B switch
//! for as long as the release builds have not all run with it, not a
//! per-type fallback.

use bun_collections::HashMap;
use core::ffi::{CStr, c_void};
use core::ptr;
use std::sync::{LazyLock, OnceLock};

use bun_threading::Guarded;

use super::Obj;
use super::dynamic::{Enc, Scalar, StructType};

// ────────────────────────────────── ABI ──────────────────────────────────────

/// `ffi_type`.
#[repr(C)]
struct Type {
    size: usize,
    alignment: u16,
    kind: u16,
    /// NULL-terminated, for a struct; NULL otherwise.
    elements: *mut *mut Type,
}

const FFI_TYPE_STRUCT: u16 = 13;

/// `ffi_cif`, with the one extra field Apple's arm64 port adds.
#[repr(C)]
struct Cif {
    abi: u32,
    nargs: u32,
    arg_types: *mut *mut Type,
    rtype: *mut Type,
    bytes: u32,
    flags: u32,
    #[cfg(target_arch = "aarch64")]
    aarch64_nfixedargs: u32,
}

/// `FFI_DEFAULT_ABI`: `FFI_SYSV` on arm64, `FFI_UNIX64` on x86_64.
const DEFAULT_ABI: u32 = if cfg!(target_arch = "aarch64") { 1 } else { 2 };
const FFI_OK: u32 = 0;

type PrepCif = unsafe extern "C" fn(*mut Cif, u32, u32, *mut Type, *mut *mut Type) -> u32;
type PrepCifVar = unsafe extern "C" fn(*mut Cif, u32, u32, u32, *mut Type, *mut *mut Type) -> u32;
/// `ffi_call`.
type Call = unsafe extern "C" fn(*mut Cif, *const c_void, *mut c_void, *mut *mut c_void);
type ClosureAlloc = unsafe extern "C" fn(usize, *mut *mut c_void) -> *mut c_void;
type PrepClosureLoc =
    unsafe extern "C" fn(*mut c_void, *mut Cif, ClosureFn, *mut c_void, *mut c_void) -> u32;

/// The function a closure enters (`void (*fun)(ffi_cif *, void *ret, void
/// **args, void *user_data)`): `args[i]` points at argument `i`'s value,
/// the result goes where `ret` points (a whole register for anything
/// smaller), `user_data` is what the closure was made with.
pub(super) type ClosureFn = unsafe extern "C" fn(
    cif: *mut c_void,
    ret: *mut c_void,
    args: *mut *mut c_void,
    user_data: *mut c_void,
);

/// Room for libffi's `ffi_closure` on either architecture (40 bytes on
/// arm64, 48 on x86_64); `ffi_closure_alloc` takes the size wanted.
const CLOSURE_SIZE: usize = 64;

/// `ffi_call(cif, function, rvalue, avalue)` made through `call` under a
/// catch frame: `true` when it returned, `false` with a +1 reference (taken
/// with `retain`) to the thrown object in `exception` when Objective-C code
/// under it raised.
pub type CallFrame = unsafe extern "C" fn(
    call: *const c_void,
    retain: unsafe extern "C" fn(Obj) -> Obj,
    cif: *mut c_void,
    function: *const c_void,
    rvalue: *mut c_void,
    avalue: *mut *mut c_void,
    exception: *mut *mut c_void,
) -> bool;

// ──────────────────────────────── library ────────────────────────────────────

struct Lib {
    ffi_prep_cif: PrepCif,
    ffi_prep_cif_var: PrepCifVar,
    ffi_call: Call,
    /// `None` when the library has no closure entry points.
    closures: Option<(ClosureAlloc, PrepClosureLoc)>,
    void: *mut Type,
    uint8: *mut Type,
    sint8: *mut Type,
    uint16: *mut Type,
    sint16: *mut Type,
    uint32: *mut Type,
    sint32: *mut Type,
    uint64: *mut Type,
    sint64: *mut Type,
    float: *mut Type,
    double: *mut Type,
    pointer: *mut Type,
}

// SAFETY: function pointers and the addresses of libffi's constant type
// descriptors, written once; libffi's entry points are callable from any
// thread. Storage in a OnceLock needs these.
unsafe impl Send for Lib {}
// SAFETY: as above.
unsafe impl Sync for Lib {}

static LIB: OnceLock<Option<Lib>> = OnceLock::new();

/// The library, loaded on first call; `None` when it is not there or the
/// feature flag turns it off, from then on.
fn lib() -> Option<&'static Lib> {
    LIB.get_or_init(|| {
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_OBJC_LIBFFI.get() == Some(true)
        {
            return None;
        }
        Lib::open()
    })
    .as_ref()
}

/// Whether sends can go through libffi in this process at all.
pub(super) fn available() -> bool {
    lib().is_some()
}

/// Whether [`Closure`]s can be made: the library loaded with its closure
/// entry points, and the first one asked for was granted. An x86_64
/// process signed with the hardened runtime and without the
/// `com.apple.security.cs.allow-unsigned-executable-memory` entitlement is
/// refused the writable trampoline page libffi writes closures into there
/// (arm64 maps a prebuilt trampoline table and is never refused).
pub(super) fn closures_available() -> bool {
    static GRANTED: OnceLock<bool> = OnceLock::new();
    *GRANTED.get_or_init(|| {
        let Some((alloc, _)) = lib().and_then(|lib| lib.closures) else {
            return false;
        };
        let mut code = ptr::null_mut();
        // SAFETY: a size and a word to fill; the block is kept (one per
        // process) rather than handed back.
        !unsafe { alloc(CLOSURE_SIZE, &raw mut code) }.is_null() && !code.is_null()
    })
}

impl Lib {
    fn open() -> Option<Lib> {
        // SAFETY: dlopen with a constant NUL-terminated path; the handle is
        // never closed.
        let handle = unsafe {
            libc::dlopen(
                c"/usr/lib/libffi.dylib".as_ptr(),
                libc::RTLD_LAZY | libc::RTLD_LOCAL,
            )
        };
        if handle.is_null() {
            return None;
        }
        let sym = |name: &CStr| {
            // SAFETY: dlsym on that handle with a NUL-terminated name.
            let p = unsafe { libc::dlsym(handle, name.as_ptr()) };
            (!p.is_null()).then_some(p)
        };
        let ty = |name: &CStr| sym(name).map(<*mut c_void>::cast::<Type>);
        // SAFETY: each function is given the type Apple's <ffi/ffi.h>
        // declares for it.
        let (ffi_prep_cif, ffi_prep_cif_var, ffi_call) = unsafe {
            (
                super::fn_from_symbol::<PrepCif>(sym(c"ffi_prep_cif")?),
                super::fn_from_symbol::<PrepCifVar>(sym(c"ffi_prep_cif_var")?),
                super::fn_from_symbol::<Call>(sym(c"ffi_call")?),
            )
        };
        let closures = match (sym(c"ffi_closure_alloc"), sym(c"ffi_prep_closure_loc")) {
            // SAFETY: as above.
            (Some(alloc), Some(prep)) => Some(unsafe {
                (
                    super::fn_from_symbol::<ClosureAlloc>(alloc),
                    super::fn_from_symbol::<PrepClosureLoc>(prep),
                )
            }),
            _ => None,
        };
        Some(Lib {
            ffi_prep_cif,
            ffi_prep_cif_var,
            ffi_call,
            closures,
            void: ty(c"ffi_type_void")?,
            uint8: ty(c"ffi_type_uint8")?,
            sint8: ty(c"ffi_type_sint8")?,
            uint16: ty(c"ffi_type_uint16")?,
            sint16: ty(c"ffi_type_sint16")?,
            uint32: ty(c"ffi_type_uint32")?,
            sint32: ty(c"ffi_type_sint32")?,
            uint64: ty(c"ffi_type_uint64")?,
            sint64: ty(c"ffi_type_sint64")?,
            float: ty(c"ffi_type_float")?,
            double: ty(c"ffi_type_double")?,
            pointer: ty(c"ffi_type_pointer")?,
        })
    }

    fn scalar(&self, scalar: Scalar) -> *mut Type {
        match scalar {
            Scalar::Bool => self.uint8,
            Scalar::Int { bits: 8, signed } => {
                if signed {
                    self.sint8
                } else {
                    self.uint8
                }
            }
            Scalar::Int { bits: 16, signed } => {
                if signed {
                    self.sint16
                } else {
                    self.uint16
                }
            }
            Scalar::Int { bits: 32, signed } => {
                if signed {
                    self.sint32
                } else {
                    self.uint32
                }
            }
            Scalar::Int { signed, .. } => {
                if signed {
                    self.sint64
                } else {
                    self.uint64
                }
            }
            Scalar::F32 => self.float,
            Scalar::F64 => self.double,
        }
    }
}

// ───────────────────────────────── types ─────────────────────────────────────

/// A struct type built by [`struct_type`]: libffi's descriptor, leaked, its
/// size and alignment (and its nested members') already filled in, so
/// nothing writes to it again. `None` for one libffi lays out differently
/// from [`StructType`].
#[derive(Clone, Copy)]
struct Built(Option<*mut Type>);

// SAFETY: the address of a leaked descriptor that is complete and read-only
// from here on (see above); libffi reads it from whichever thread calls.
unsafe impl Send for Built {}

/// Struct types built so far by any thread, by encoding: each is built and
/// leaked once for the process.
static STRUCTS: LazyLock<Guarded<HashMap<Box<str>, Built>>> = LazyLock::new(Default::default);
/// Call interfaces prepared so far by any thread, by [`key`]: each is
/// prepared and leaked once for the process (closures made on one thread are
/// entered on others with it).
static PREPARED: LazyLock<Guarded<HashMap<Box<str>, Option<&'static Prepared>>>> =
    LazyLock::new(Default::default);

/// `{name=members}` as an `ffi_type`, members nested the way the encoding
/// nests them (libffi computes offsets itself, and a nested struct can be
/// aligned past where its first scalar alone would sit).
fn struct_type(lib: &Lib, t: &StructType) -> Option<*mut Type> {
    let mut structs = STRUCTS.lock();
    if let Some(known) = structs.get(t.encoding) {
        return known.0;
    }
    let mut chars = t.encoding.chars().peekable();
    let built = build_struct(lib, &mut chars).filter(|_| chars.next().is_none());
    let checked = built.filter(|&ty| {
        // libffi sizes a struct type (and every struct inside it) the first
        // time a cif uses it, and only then: done here, before any other
        // thread can see it.
        let mut cif = Cif::EMPTY;
        // SAFETY: a cif to fill, no arguments, and a well-formed struct type
        // (NULL-terminated elements) that is never freed; libffi writes its
        // size and alignment, read back once it returns.
        unsafe {
            (lib.ffi_prep_cif)(&raw mut cif, DEFAULT_ABI, 0, ty, ptr::null_mut()) == FFI_OK
                && (*ty).size == t.size
        }
    });
    structs.insert(t.encoding.into(), Built(checked));
    checked
}

/// One `{name=members}` from `chars`, allocated for good.
fn build_struct(
    lib: &Lib,
    chars: &mut core::iter::Peekable<core::str::Chars<'_>>,
) -> Option<*mut Type> {
    if chars.next() != Some('{') {
        return None;
    }
    loop {
        match chars.next()? {
            '=' => break,
            '}' => return None,
            _ => {}
        }
    }
    let mut elements: Vec<*mut Type> = Vec::new();
    loop {
        match *chars.peek()? {
            '}' => {
                chars.next();
                break;
            }
            '{' => elements.push(build_struct(lib, chars)?),
            c => {
                chars.next();
                if let Some(scalar) = Scalar::of(c) {
                    elements.push(lib.scalar(scalar));
                } else if !super::dynamic::is_qualifier(c) {
                    return None;
                }
            }
        }
    }
    if elements.is_empty() {
        return None;
    }
    elements.push(ptr::null_mut());
    let elements = Box::leak(elements.into_boxed_slice()).as_mut_ptr();
    Some(Box::into_raw(Box::new(Type {
        size: 0,
        alignment: 0,
        kind: FFI_TYPE_STRUCT,
        elements,
    })))
}

/// `enc` as an `ffi_type`, or `None` for one this path does not carry
/// ([`Enc::Other`], and a struct libffi disagrees on). Everything that
/// crosses as an address is a pointer.
fn ffi_type(lib: &Lib, enc: &Enc) -> Option<*mut Type> {
    Some(match enc {
        Enc::Void => lib.void,
        Enc::Object
        | Enc::CFObject(_)
        | Enc::Block
        | Enc::Class
        | Enc::Sel
        | Enc::CString
        | Enc::Out(_)
        | Enc::Buffer(_)
        | Enc::Pointer => lib.pointer,
        Enc::Bool => lib.scalar(Scalar::Bool),
        Enc::Int { bits, signed } => lib.scalar(Scalar::Int {
            bits: *bits,
            signed: *signed,
        }),
        Enc::F32 => lib.float,
        Enc::F64 => lib.double,
        Enc::Struct(t) => struct_type(lib, t)?,
        Enc::Other(_) => return None,
    })
}

/// The cache key for a call shape: the return type, then every argument,
/// each as one letter (all pointers alike) or a struct's encoding, then the
/// fixed-argument count when variadic.
fn key(ret: &Enc, args: &[&Enc], fixed: Option<usize>) -> String {
    fn code(enc: &Enc, out: &mut String) {
        match enc {
            Enc::Struct(t) => out.push_str(t.encoding),
            Enc::Other(_) => out.push('?'),
            Enc::Void | Enc::Bool | Enc::Int { .. } | Enc::F32 | Enc::F64 => {
                out.push_str(&enc.encoding())
            }
            _ => out.push('^'),
        }
    }
    let mut key = String::with_capacity(args.len() + 8);
    code(ret, &mut key);
    key.push('(');
    for arg in args {
        code(arg, &mut key);
    }
    key.push(')');
    if let Some(fixed) = fixed {
        key.push_str(&fixed.to_string());
    }
    key
}

// ──────────────────────────────── prepared ───────────────────────────────────

/// A prepared call interface for one shape of call: what `ffi_call` needs
/// to place the arguments and fetch the result.
pub(super) struct Prepared {
    cif: Cif,
    /// What `cif.arg_types` points at.
    _arg_types: Box<[*mut Type]>,
    /// The result is a struct `objc_msgSend_stret` returns through a hidden
    /// pointer (libffi classes it MEMORY by the same rule).
    #[cfg(target_arch = "x86_64")]
    pub stret: bool,
}

// SAFETY: written once by `prepare` and read-only after; the pointers are
// to type descriptors that are libffi's constants or leaked and complete
// (`Built`), and `ffi_call` and closures read a cif from any thread.
unsafe impl Sync for Prepared {}

impl Cif {
    const EMPTY: Cif = Cif {
        abi: 0,
        nargs: 0,
        arg_types: ptr::null_mut(),
        rtype: ptr::null_mut(),
        bytes: 0,
        flags: 0,
        #[cfg(target_arch = "aarch64")]
        aarch64_nfixedargs: 0,
    };
}

/// The call interface for a function returning `ret` and taking `args` (the
/// receiver and selector, or the block, included), the first `fixed` of
/// them declared and the rest variadic when `fixed` is `Some`. `None` when
/// libffi is off or a type is not one it carries here. Prepared once per
/// shape for the process.
pub(super) fn prepared(
    ret: &Enc,
    args: &[&Enc],
    fixed: Option<usize>,
) -> Option<&'static Prepared> {
    let lib = lib()?;
    let key = key(ret, args, fixed);
    let mut all = PREPARED.lock();
    if let Some(known) = all.get(key.as_str()) {
        return *known;
    }
    let made = prepare(lib, ret, args, fixed);
    all.insert(key.into_boxed_str(), made);
    made
}

fn prepare(lib: &Lib, ret: &Enc, args: &[&Enc], fixed: Option<usize>) -> Option<&'static Prepared> {
    let rtype = ffi_type(lib, ret)?;
    let mut arg_types = args
        .iter()
        .map(|enc| ffi_type(lib, enc))
        .collect::<Option<Box<[*mut Type]>>>()?;
    let nargs = u32::try_from(arg_types.len()).ok()?;
    let atypes = arg_types.as_mut_ptr();
    let mut cif = Cif::EMPTY;
    // SAFETY: a cif to fill; the argument type array is heap storage that
    // moves into the `Prepared` with the cif and is leaked with it; every
    // type is libffi's own descriptor or a struct type built above.
    let status = unsafe {
        match fixed {
            None => (lib.ffi_prep_cif)(&raw mut cif, DEFAULT_ABI, nargs, rtype, atypes),
            Some(fixed) => (lib.ffi_prep_cif_var)(
                &raw mut cif,
                DEFAULT_ABI,
                u32::try_from(fixed).ok()?,
                nargs,
                rtype,
                atypes,
            ),
        }
    };
    if status != FFI_OK {
        return None;
    }
    Some(Box::leak(Box::new(Prepared {
        cif,
        _arg_types: arg_types,
        #[cfg(target_arch = "x86_64")]
        stret: matches!(ret, Enc::Struct(t) if t.size > 16),
    })))
}

impl Prepared {
    /// Calls `function` with `args` (one pointer per argument, each to a
    /// value of that argument's type) and the result written to `ret`
    /// (room for the return type, and at least 16 bytes). Under `frame`, an
    /// Objective-C exception raised inside comes back as `Err` holding the
    /// thrown object (+1) or nil; without one it ends the process.
    ///
    /// # Safety
    /// `function` has the C signature this was prepared for, and `args` and
    /// `ret` are as described.
    pub(super) unsafe fn call(
        &self,
        frame: Option<CallFrame>,
        function: *const c_void,
        ret: *mut c_void,
        args: *mut *mut c_void,
    ) -> core::result::Result<(), Obj> {
        let lib = lib().expect("a Prepared exists only once libffi loaded");
        let cif = ptr::from_ref(&self.cif).cast_mut();
        let Some(frame) = frame else {
            // SAFETY: caller contract; ffi_call only reads the cif.
            unsafe { (lib.ffi_call)(cif, function, ret, args) };
            return Ok(());
        };
        let mut thrown: Obj = ptr::null_mut();
        // SAFETY: `frame` is `Bun__ffi__tryCall`, whose parameters these are:
        // libffi's `ffi_call`, the runtime's retain, and the four arguments
        // `ffi_call` takes, per the caller contract.
        let returned = unsafe {
            frame(
                lib.ffi_call as *const c_void,
                super::rt().objc_retain,
                cif.cast(),
                function,
                ret,
                args,
                &raw mut thrown,
            )
        };
        if returned { Ok(()) } else { Err(thrown) }
    }
}

// ──────────────────────────────── closures ───────────────────────────────────

/// A C function made at run time: calling [`code`](Closure::code) with the
/// arguments `prepared` describes enters `fun` with `user_data`. Never
/// freed: what is built on one (a block's invoke function, a method's IMP)
/// lives for the process.
pub(super) struct Closure {
    code: *const c_void,
}

impl Closure {
    /// `None` when closures are not available or libffi refuses this one.
    ///
    /// # Safety
    /// `fun` must treat `ret` and `args` as the types `prepared` was made
    /// for, and `user_data` as what is passed here, for as long as anything
    /// can call `code`.
    pub(super) unsafe fn new(
        prepared: &'static Prepared,
        fun: ClosureFn,
        user_data: *mut c_void,
    ) -> Option<Closure> {
        if !closures_available() {
            return None;
        }
        let (alloc, prep) = lib()?.closures?;
        let mut code = ptr::null_mut();
        // SAFETY: a size and a word to fill.
        let writable = unsafe { alloc(CLOSURE_SIZE, &raw mut code) };
        if writable.is_null() || code.is_null() {
            return None;
        }
        let cif = ptr::from_ref(&prepared.cif).cast_mut();
        // SAFETY: the closure just allocated with its code address, a cif
        // that lives for the process (a `Prepared` is leaked), and the
        // caller's function and data per contract.
        let status = unsafe { prep(writable, cif, fun, user_data, code) };
        (status == FFI_OK).then_some(Closure { code })
    }

    /// The address to call (or install as an IMP, or a block's `invoke`).
    pub(super) fn code(&self) -> *const c_void {
        self.code
    }
}

/// Part of `verify_bindings`: libffi loads, and lays out the structs the
/// frameworks pass by value the way [`StructType`] does.
pub(super) fn verify(problems: &mut Vec<String>) {
    let Some(lib) = lib() else {
        problems.push(
            "/usr/lib/libffi.dylib did not load (or BUN_FEATURE_FLAG_DISABLE_OBJC_LIBFFI is set)"
                .into(),
        );
        return;
    };
    for encoding in super::dynamic::VERIFIED_STRUCTS {
        let text = encoding.to_string_lossy();
        let Enc::Struct(t) = Enc::parse(&text) else {
            problems.push(format!("{text} does not parse as a struct"));
            continue;
        };
        if struct_type(lib, t).is_none() {
            problems.push(format!(
                "{text}: libffi lays it out differently from the {} bytes computed here",
                t.size
            ));
        }
    }
    let object = Enc::Object;
    if prepared(&Enc::Object, &[&object, &Enc::Sel, &object], Some(2)).is_none() {
        problems.push("ffi_prep_cif_var refused (id, SEL, ...)".into());
    }
}
