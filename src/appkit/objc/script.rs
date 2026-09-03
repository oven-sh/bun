//! Classes whose methods are functions a script gave: what
//! `objc.defineClass()` and `objc.target()` in `bun:objc` build.
//!
//! Every such method is added to the class (a class method to its
//! metaclass) with the method's real type encoding and, as its IMP, a libffi
//! closure for that encoding ([`ffi::Closure`]), so `respondsToSelector:`,
//! `methodSignatureForSelector:`, `conformsToProtocol:`, a `super` send from
//! a subclass and a superclass method being overridden all see an ordinary
//! method. The closure unpacks its arguments with [`super::dynamic`]'s
//! machinery and hands them to the class's [`Methods`]. Where libffi cannot
//! make closures, the IMP is the runtime's forwarding trampoline instead and
//! every call lands in one `forwardInvocation:` that unpacks the
//! `NSInvocation` the same way (class methods are refused then). The root
//! script class of a chain (the first whose superclass is a framework class)
//! also gets one pointer ivar for data a script attaches to an instance, and
//! a `dealloc` that frees it.
//!
//! A class is the process's, but its methods belong to one thread (see
//! [`handoff`]): the thread that defined it, or for a class defined
//! [instance-owned](ClassSpec::instance_owned) the thread that attached data
//! to the instance messaged. A message that arrives on another thread is
//! handed over to that thread when the method returns nothing and takes no
//! pointers, and otherwise answered with zero and reported to it.

use core::any::Any;
use core::ffi::c_void;
use core::ptr::null_mut;
use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};
use std::ffi::CString;

use super::define::{Declarations, ivar_offset};
use super::dynamic::{
    self, DynClass, DynObject, DynValue, Enc, Family, Frame, Frames, HandedOver, Initializing,
    Keep, Reply, Signature, Spelling, decode, encode, encode_result, frames_of, leave_result,
    pool_if_none, read_out, unsupported, write_out,
};
use super::ffi;
use super::foundation::{NSInvocation, NSObject};
use super::handoff::{self, Owner};
use super::{
    Bool, Class, ClassType, Id, Obj, Object, Sel, is_main_thread, load, main_thread_only,
    register_sel, rt, sel,
};
use crate::error::{Error, Result};
use bun_core::strings;

/// One method: its selector and, when the script gave one, its type
/// encoding (`"v@:@"`; otherwise see [`define_class`]).
pub struct MethodSpec {
    pub selector: String,
    pub types: Option<String>,
    /// The method's result, when it is the same boolean, number or nil every
    /// time: then no function is called and any thread may send it.
    pub constant: Option<DynValue>,
}

pub struct ClassSpec {
    /// Empty for a generated name.
    pub name: String,
    pub superclass: DynClass,
    /// Adopted so `conformsToProtocol:` answers for them, and searched for
    /// the type encodings of methods the script did not type.
    pub protocols: Vec<String>,
    pub methods: Vec<MethodSpec>,
    /// Methods of the class object itself (`+sharedInstance`).
    pub class_methods: Vec<MethodSpec>,
    /// The methods run, not on the defining thread, but on whichever thread
    /// [`attach`]ed data to the instance messaged (nowhere until one has):
    /// one class then serves every thread, so its [`Methods`] must hold
    /// nothing of one thread's and find what to call in that data.
    pub instance_owned: bool,
}

/// One message to an instance (or the class object) of a script-defined class.
pub struct Call<'a> {
    /// The instance, or for a class method the class object.
    pub receiver: DynObject,
    /// The class that defines the method being run (the receiver's, or a
    /// script class above it): where a `super` send from it starts.
    pub class: DynClass,
    /// The method's position among the function (non-constant) methods of
    /// the class that defines it: its instance methods in
    /// [`ClassSpec::methods`] order, then its class methods.
    pub index: usize,
    /// For a per-instance table lookup.
    pub selector: &'a str,
    /// `-[Class selector]`, for messages.
    pub method: &'a str,
    /// One per parameter; an [`Enc::Out`] parameter arrives as the value it
    /// points at, zero for NULL.
    pub args: Vec<dynamic::DynValue>,
    pub params: &'a [Enc],
    /// What the returned value will be encoded as.
    pub ret: &'a Enc,
    /// What [`attach`] stored on the receiver, if anything.
    pub instance: Option<&'a dyn Any>,
}

/// The script side of a class. Both run on the class's thread only (see
/// [`ClassSpec::instance_owned`]), inside whatever sent the message (AppKit
/// event dispatch, or a bridged send from the script itself), so they may be
/// re-entered.
pub trait Methods {
    fn call(&self, call: Call<'_>) -> Reply;
    /// A message that could not be delivered or answered for a reason on
    /// this side; the sender reads zero, so the script is told this way.
    fn report(&self, err: Error);
}

struct Method {
    sel: Sel,
    selector: String,
    sig: Signature,
    /// See [`Call::index`].
    index: usize,
}

/// A registered script class. Leaked: classes never go away.
struct Entry {
    /// The entry registered before this one; see [`CLASSES`].
    next: *const Entry,
    class: Class,
    /// The function methods, in [`ClassSpec::methods`] order.
    methods: Vec<Method>,
    /// Likewise for [`ClassSpec::class_methods`].
    class_methods: Vec<Method>,
    /// Where instances keep their [`attach`]ed data (the root's ivar).
    data_offset: isize,
    /// The thread the methods run on and `handler` is called on: the one
    /// that defined the class, or `None` when each instance's data names it
    /// (and `handler`, called on any of those, keeps nothing of one thread's).
    owner: Option<&'static Owner>,
    handler: Box<dyn Methods>,
    /// What the class was defined from, compared when the name is asked
    /// for again; see [`Defined::rebound`].
    shape: String,
}

/// What [`define_class`] returns.
pub struct Defined {
    pub class: DynClass,
    /// The name was already this thread's script class of the very same
    /// shape (superclass, protocols, selectors, types, constants), defined
    /// by an earlier load of the same script (another global under
    /// `bun test --isolate`, a hot reload): that class is returned again and
    /// keeps the handler it was defined with, the new one is dropped, and
    /// the caller points what that handler reads at the new functions.
    pub rebound: bool,
}

/// `spec` as one comparable string: everything that decides the class's
/// methods, their types and their order.
fn shape_of(spec: &ClassSpec) -> String {
    let mut shape = format!(
        "{:p}|{}|",
        spec.superclass.0.as_obj(),
        spec.protocols.join(",")
    );
    for (sign, list) in [('-', &spec.methods), ('+', &spec.class_methods)] {
        for m in list {
            shape.push_str(&format!(
                "{sign}{}|{:?}|{:?}|",
                m.selector, m.types, m.constant
            ));
        }
    }
    shape
}

/// What a method's closure IMP is entered with: which method of which
/// class it is. Leaked with the class.
struct Imp {
    entry: *const Entry,
    class_method: bool,
    /// Index into [`Entry::methods`] or [`Entry::class_methods`].
    at: usize,
}

/// What the ivar points at while data is attached: the script's value and
/// the thread it must be dropped on.
struct InstanceData {
    owner: &'static Owner,
    data: Box<dyn Any>,
}

const IVAR: &core::ffi::CStr = c"_bunScriptData";

/// Every script class any thread has defined, newest first: pushed once when
/// registered and never removed or changed, so any thread may walk it.
static CLASSES: AtomicPtr<Entry> = AtomicPtr::new(null_mut());
static GENERATED_NAMES: AtomicUsize = AtomicUsize::new(0);

/// The registered entries, newest first.
fn entries() -> impl Iterator<Item = &'static Entry> {
    // SAFETY: the head and every `next` are null or an `Entry` leaked by
    // `define_class` and published with `Release` after it was complete.
    let head = unsafe { CLASSES.load(Ordering::Acquire).as_ref() };
    // SAFETY: as above.
    core::iter::successors(head, |e| unsafe { e.next.as_ref() })
}

/// Selectors a script may not define: the bridge owns reference counting,
/// and the two forwarding hooks are how methods are delivered without closures.
const RESERVED: &[&str] = &[
    "retain",
    "release",
    "autorelease",
    "retainCount",
    "allowsWeakReference",
    "retainWeakReference",
    "dealloc",
    "forwardInvocation:",
    "methodSignatureForSelector:",
];

/// Selectors a script may define only as real IMPs: without closures every
/// method is the runtime's forwarding trampoline, which asks the receiver
/// this on the way to `forwardInvocation:`, so answering it by forwarding
/// would never end.
const RESERVED_WITHOUT_CLOSURES: &[&str] = &["forwardingTargetForSelector:"];

/// Class methods a script may not define: the bridge sends `alloc` itself,
/// later, and counts on what it does.
const RESERVED_CLASS: &[&str] = &["alloc", "allocWithZone:"];

/// The script classes at or above `class`, nearest first.
fn script_classes(class: Class) -> impl Iterator<Item = &'static Entry> {
    rt().class_chain(class)
        .filter_map(|c| entries().find(|e| e.class == c))
}

/// The script method a message `sel` to an instance of `class` runs: the
/// nearest script class up the chain that defines it, and the method there.
fn script_method(class: Class, sel: Sel) -> Option<(&'static Entry, &'static Method)> {
    script_classes(class).find_map(|e| e.methods.iter().find(|m| m.sel == sel).map(|m| (e, m)))
}

/// The signature the nearest script class up the chain of `class` defined
/// `sel` with (an instance or a class method), as its script spelled it:
/// what tells a `c` it wrote for a `char` from the `BOOL` the runtime
/// reports the method's type as on x86_64.
pub(super) fn written_signature(
    class: Class,
    sel: Sel,
    class_method: bool,
) -> Option<&'static Signature> {
    script_classes(class).find_map(|e| {
        let methods = if class_method {
            &e.class_methods
        } else {
            &e.methods
        };
        methods.iter().find(|m| m.sel == sel).map(|m| &m.sig)
    })
}

fn generated_name() -> String {
    loop {
        let n = GENERATED_NAMES.fetch_add(1, Ordering::Relaxed) + 1;
        let name = format!("BunScriptObject{n}");
        let c_name = CString::new(name.as_str()).expect("no NUL in a generated name");
        if super::lookup_class(&c_name).is_none() {
            return name;
        }
    }
}

/// Registers the class `spec` describes, delivering its methods to `handler`
/// on this thread.
///
/// A method's type encoding is, in order: the one the script gave (which
/// must pass arguments the way anything below does, when there is one);
/// what an adopted protocol declares for the selector; what the superclass
/// chain implements for it; what a protocol a class up that chain adopts
/// declares; else [`Error::UnsupportedSignature`], naming the registered
/// protocols that do declare it. A class method's: the one the script gave,
/// else the superclass's, else that same error.
pub fn define_class(spec: &ClassSpec, handler: Box<dyn Methods>) -> Result<Defined> {
    load()?;
    let _pool = pool_if_none();
    let superclass = spec.superclass.0;
    main_thread_only(superclass, None)?;
    // One chain, one owner: `deliver` hands a subclass's attached data to
    // whichever class up the chain defines the selector.
    if let Some(base) = script_classes(superclass).next()
        && (spec.instance_owned || !base.owner.is_some_and(Owner::is_current))
    {
        return Err(Error::OtherThread(
            "objc.defineClass(): the superclass is a script-defined class whose methods do not run on this thread; subclass it on the thread that defined it",
        ));
    }
    let owner = handoff::current();
    // The class table is the process's: the plain name is the main thread's,
    // whichever thread defines first, and any other thread's class is told
    // apart by that thread's number.
    let name = if spec.name.is_empty() {
        generated_name()
    } else if is_main_thread() {
        spec.name.clone()
    } else {
        format!("{}_{}", spec.name, owner.number())
    };
    let shape = shape_of(spec);
    let c_name = CString::new(name.as_str()).map_err(|_| Error::ClassName(name.clone()))?;
    let Some(mut decls) = Declarations::new(superclass, &c_name) else {
        // Taken: by this thread's own earlier definition of the same thing,
        // which is then the class meant, or by anything else, which is not.
        let existing = super::lookup_class(&c_name)
            .and_then(|class| entries().find(|e| e.class == class))
            .filter(|e| {
                !spec.name.is_empty() && e.owner.is_some_and(Owner::is_current) && e.shape == shape
            });
        return match existing {
            Some(entry) => Ok(Defined {
                class: DynClass(entry.class),
                rebound: true,
            }),
            None => Err(Error::ClassName(name)),
        };
    };
    let root = script_classes(superclass).next().is_none();
    // The entry exists before its methods so their IMPs can name it; it is
    // complete before the class is registered, and published after.
    let entry = bun_core::heap::into_raw(Box::new(Entry {
        next: null_mut(),
        class: decls.class(),
        methods: Vec::new(),
        class_methods: Vec::new(),
        data_offset: 0,
        owner: (!spec.instance_owned).then_some(owner),
        handler,
        shape,
    }));
    let added = add_methods(&mut decls, &name, spec, root, entry);
    let (methods, class_methods) = match added {
        Ok(added) => added,
        Err(err) => {
            decls.dispose();
            // SAFETY: never published; the class its IMPs were on is gone.
            drop(unsafe { bun_core::heap::take(entry) });
            return Err(err);
        }
    };
    // SAFETY: leaked above; only this thread sees it until the exchange
    // below, and no IMP of the class can run before it is registered.
    unsafe {
        (*entry).methods = methods;
        (*entry).class_methods = class_methods;
    }
    let class = decls.register();
    let data_offset = ivar_offset(class, IVAR).expect("script data ivar missing");
    // SAFETY: as above; nothing messages the class before this returns.
    unsafe { (*entry).data_offset = data_offset };
    let mut head = CLASSES.load(Ordering::Relaxed);
    loop {
        // SAFETY: as above.
        unsafe { (*entry).next = head };
        match CLASSES.compare_exchange_weak(head, entry, Ordering::Release, Ordering::Relaxed) {
            Ok(_) => break,
            Err(current) => head = current,
        }
    }
    Ok(Defined {
        class: DynClass(class),
        rebound: false,
    })
}

/// Adds `spec`'s instance and class methods to `decls` and returns the
/// function ones of each, whose IMPs name `entry`.
fn add_methods(
    decls: &mut Declarations,
    class_name: &str,
    spec: &ClassSpec,
    root: bool,
    entry: *const Entry,
) -> Result<(Vec<Method>, Vec<Method>)> {
    for protocol in &spec.protocols {
        let adopted = CString::new(protocol.as_str()).is_ok_and(|p| decls.try_adopt(&p));
        if !adopted {
            return Err(Error::NoProtocol(protocol.clone()));
        }
    }
    let closures = ffi::closures_available();
    let mut adding = Adding {
        decls,
        class_name,
        closures,
        entry,
        index: 0,
        defined: Vec::with_capacity(spec.methods.len()),
    };
    let methods = adding.list(&spec.methods, false)?;
    for (protocol, required) in adding.decls.required() {
        let missing: Vec<String> = required
            .into_iter()
            .filter(|sel| !adding.defined.contains(sel) && !adding.decls.inherits(*sel))
            .map(|sel| rt().sel_name(sel))
            .collect();
        if !missing.is_empty() {
            return Err(Error::RequiredMethods {
                class: class_name.to_owned(),
                protocol: protocol.to_owned(),
                missing: missing.join(", "),
            });
        }
    }
    if !spec.class_methods.is_empty() && !closures {
        return Err(unsupported(
            &format!("+[{class_name} {}]", spec.class_methods[0].selector),
            "class methods need libffi closures, which are not available here",
        ));
    }
    adding.defined.clear();
    let class_methods = adding.list(&spec.class_methods, true)?;
    let decls = adding.decls;
    if root {
        decls.add_pointer_ivar(IVAR);
        // SAFETY: both transcribe NSObject's declarations, which debug builds check.
        unsafe {
            if !closures {
                decls.add_method(
                    sel!("forwardInvocation:"),
                    forward_invocation as extern "C" fn(Obj, Sel, Obj),
                );
            }
            decls.add_method(sel!("dealloc"), dealloc as extern "C" fn(Obj, Sel));
        }
    }
    Ok((methods, class_methods))
}

/// [`add_methods`] part way: `index` counts function methods across the
/// instance and class lists, `defined` collects the selectors of the list
/// being added.
struct Adding<'a> {
    decls: &'a mut Declarations,
    class_name: &'a str,
    closures: bool,
    entry: *const Entry,
    index: usize,
    defined: Vec<Sel>,
}

impl Adding<'_> {
    /// Adds the instance (or, `class_method`, class) methods `specs` describe.
    fn list(&mut self, specs: &[MethodSpec], class_method: bool) -> Result<Vec<Method>> {
        let Adding {
            decls,
            class_name,
            closures,
            entry,
            index,
            defined,
        } = self;
        let (decls, class_name, closures, entry) = (&mut **decls, *class_name, *closures, *entry);
        let mut methods: Vec<Method> = Vec::with_capacity(specs.len());
        let sign = if class_method { '+' } else { '-' };
        for MethodSpec {
            selector,
            types,
            constant,
        } in specs
        {
            let name = format!("{sign}[{class_name} {selector}]");
            let reserved = RESERVED.contains(&selector.as_str())
                || (class_method && RESERVED_CLASS.contains(&selector.as_str()));
            if selector.is_empty() || reserved {
                return Err(unsupported(
                    &name,
                    "this selector cannot be defined by a script",
                ));
            }
            if !closures && RESERVED_WITHOUT_CLOSURES.contains(&selector.as_str()) {
                return Err(unsupported(
                    &name,
                    "this selector needs libffi closures to be defined, which are not available here",
                ));
            }
            let c_sel = CString::new(selector.as_str())
                .map_err(|_| unsupported(&name, "a selector cannot contain NUL"))?;
            let sel = register_sel(&c_sel);
            let colons = strings::count_char(selector.as_bytes(), b':');
            let declared = if class_method {
                decls
                    .declared_class_method(sel)
                    .map(|types| ("the superclass".to_owned(), types))
            } else {
                decls.declared(sel)
            };
            // An explicit encoding stands, but it cannot change how a caller
            // written against the protocol or superclass passes the arguments.
            if let (Some(given), Some((source, declared))) = (&types, &declared)
                && !declared.is_empty()
                && super::calling_shape(given) != super::calling_shape(declared)
            {
                let mut shown = declared.clone();
                shown.retain(|c| !c.is_ascii_digit());
                return Err(unsupported(
                    &name,
                    format!(
                        "`types` {given:?} does not match {shown:?}, which {source} declares for this selector"
                    ),
                ));
            }
            let given = types.is_some();
            let types = match types.clone().or_else(|| declared.map(|(_, types)| types)) {
                Some(types) => types,
                None => {
                    let example = format!(
                        "{{ types: \"{}@:{}\", fn }}",
                        if colons == 0 { "@" } else { "v" },
                        "@".repeat(colons)
                    );
                    let suggested = match class_method {
                        true => Vec::new(),
                        false => decls.suggested_protocols(sel),
                    };
                    let why = match suggested.as_slice() {
                        [] => format!(
                            "no adopted protocol or superclass declares this selector, so its types are unknown; give them, e.g. {example} for an object result and object arguments, or list the protocol that declares it in `protocols`"
                        ),
                        [(protocol, types)] => format!(
                            "no adopted protocol or superclass declares this selector; {protocol} does ({types}): list it in `protocols`, or give `types`"
                        ),
                        several => format!(
                            "no adopted protocol or superclass declares this selector; {} do: list the one meant in `protocols`, or give `types`",
                            several
                                .iter()
                                .map(|(protocol, types)| format!("{protocol} ({types})"))
                                .collect::<Vec<_>>()
                                .join(", ")
                        ),
                    };
                    return Err(unsupported(&name, why));
                }
            };
            if defined.contains(&sel) {
                return Err(unsupported(&name, "defined twice"));
            }
            defined.push(sel);
            let spelling = if given {
                Spelling::Written
            } else {
                Spelling::Runtime
            };
            let (sig, c_types) =
                parse_types(name, DynClass(decls.class()), sel, &types, colons, spelling)?;
            let add = |imp: *const c_void| {
                // SAFETY: `imp` behaves as a method of type `c_types` (the
                // caller's contract just below); the metaclass for a class method.
                unsafe {
                    if class_method {
                        decls.add_class_raw(sel, imp, c_types.as_ptr());
                    } else {
                        decls.add_raw(sel, imp, c_types.as_ptr());
                    }
                }
            };
            if let Some(value) = constant {
                // An IMP taking only `self`, which any method's caller passes,
                // and returning `sig.ret`, which `c_types` declares.
                add(constant_imp(&sig, value)?);
                continue;
            }
            let imp = if closures {
                let imp = Box::leak(Box::new(Imp {
                    entry,
                    class_method,
                    at: methods.len(),
                }));
                closure_imp(&sig, imp)?
            } else {
                // The forwarding trampoline is a valid IMP for any method: it
                // reads no arguments itself, and `forward_invocation` marshals
                // them by these same types.
                forwarding_imp(&sig.ret)
            };
            add(imp);
            methods.push(Method {
                sel,
                selector: selector.clone(),
                sig,
                index: *index,
            });
            *index += 1;
        }
        Ok(methods)
    }
}

/// A libffi closure to install as the IMP of the method `sig` describes,
/// entered as [`enter`] with `imp`.
fn closure_imp(sig: &Signature, imp: &'static Imp) -> Result<*const c_void> {
    let call = sig
        .call_interface()
        .ok_or_else(|| unsupported(sig.method(), "libffi cannot lay out its arguments"))?;
    // SAFETY: `enter` reads its arguments and writes its result by the
    // signature of the method `imp` names, which is `sig`, what `call` was
    // prepared from; `imp` and the entry it points at are never freed once
    // the class is registered (and the closure never runs if it is not).
    let closure =
        unsafe { ffi::Closure::new(call, enter, core::ptr::from_ref(imp).cast_mut().cast()) };
    closure
        .map(|c| c.code())
        .ok_or_else(|| unsupported(sig.method(), "could not be given a libffi closure"))
}

/// What every closure IMP enters: the receiver and `_cmd` lead the
/// arguments, the method's own follow.
unsafe extern "C" fn enter(
    _cif: *mut c_void,
    ret: *mut c_void,
    args: *mut *mut c_void,
    imp: *mut c_void,
) {
    // SAFETY: the data `closure_imp` made the closure with, leaked with its
    // entry, whose method lists were complete before the class could be sent
    // anything.
    let (entry, method, class_method) = unsafe {
        let imp = &*imp.cast::<Imp>();
        let entry = &*imp.entry;
        let list = if imp.class_method {
            &entry.class_methods
        } else {
            &entry.methods
        };
        (entry, &list[imp.at], imp.class_method)
    };
    // SAFETY: the runtime calls an IMP with the receiver, `_cmd`, then
    // arguments of the method's type, which is what the closure was
    // prepared for.
    let (this, frames) = unsafe {
        (
            (*args).cast::<Obj>().read(),
            frames_of(&method.sig.args, args.add(2)),
        )
    };
    let out = respond(this, entry, method, class_method, &frames);
    // SAFETY: `ret` is where the caller reads a result of the method's return type.
    unsafe { leave_result(&method.sig.ret, &out, ret) };
}

/// `_objc_msgForward`, which makes the runtime build an `NSInvocation` and
/// call `forwardInvocation:` (the `_stret` variant where the ABI returns
/// `ret` through a hidden pointer).
fn forwarding_imp(ret: &Enc) -> *const c_void {
    #[cfg(target_arch = "x86_64")]
    if let Enc::Struct(t) = ret
        && t.size > 16
    {
        return rt()._objc_msgForward_stret;
    }
    let _ = ret;
    rt()._objc_msgForward
}

/// A global block (never copied or freed) that captures one machine word:
/// what [`constant_imp`] hands `imp_implementationWithBlock`.
#[repr(C)]
struct ConstantBlock {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    invoke: *const c_void,
    descriptor: *const ConstantDescriptor,
    bits: u64,
}

#[repr(C)]
struct ConstantDescriptor {
    reserved: usize,
    size: usize,
}

static CONSTANT_DESCRIPTOR: ConstantDescriptor = ConstantDescriptor {
    reserved: 0,
    size: core::mem::size_of::<ConstantBlock>(),
};

const BLOCK_IS_GLOBAL: i32 = 1 << 28;

unsafe extern "C" {
    /// The class of a block with static storage, which `Block_copy` returns as is.
    static _NSConcreteGlobalBlock: [*const c_void; 32];
}

extern "C" fn constant_word(block: &ConstantBlock, _this: Obj) -> u64 {
    block.bits
}

extern "C" fn constant_f64(block: &ConstantBlock, _this: Obj) -> f64 {
    f64::from_bits(block.bits)
}

extern "C" fn constant_f32(block: &ConstantBlock, _this: Obj) -> f32 {
    f32::from_bits(block.bits as u32)
}

/// An IMP that returns `value` as `sig.ret` whoever calls it, on any thread:
/// a block capturing the encoded value, made a method by the runtime.
fn constant_imp(sig: &Signature, value: &DynValue) -> Result<*const c_void> {
    let wrong = |got: String| Error::ReturnType {
        method: sig.method().to_owned(),
        expected: sig.ret.to_string(),
        got,
    };
    let scalar = matches!(
        value,
        DynValue::Bool(_) | DynValue::I64(_) | DynValue::U64(_) | DynValue::F64(_)
    );
    let fits = match &sig.ret {
        Enc::Bool | Enc::Int { .. } | Enc::F32 | Enc::F64 => scalar,
        Enc::Void | Enc::Struct(_) => false,
        // Anything an object would have to be kept alive for is not a constant.
        _ => matches!(value, DynValue::Nil),
    };
    if !fits {
        return Err(wrong(format!(
            "the constant {}; a constant method returns a boolean, a number or null",
            value.kind()
        )));
    }
    let mut frame = Frame::new();
    encode(
        sig.method(),
        0,
        &sig.ret,
        value,
        &mut frame,
        &mut Keep::default(),
    )
    .map_err(|err| match err {
        Error::ArgType { got, .. } => wrong(got),
        err => err,
    })?;
    let invoke = match sig.ret {
        Enc::F64 => constant_f64 as extern "C" fn(&ConstantBlock, Obj) -> f64 as *const c_void,
        Enc::F32 => constant_f32 as extern "C" fn(&ConstantBlock, Obj) -> f32 as *const c_void,
        _ => constant_word as extern "C" fn(&ConstantBlock, Obj) -> u64 as *const c_void,
    };
    let block: &'static ConstantBlock = Box::leak(Box::new(ConstantBlock {
        isa: core::ptr::addr_of!(_NSConcreteGlobalBlock).cast(),
        flags: BLOCK_IS_GLOBAL,
        reserved: 0,
        invoke,
        descriptor: &raw const CONSTANT_DESCRIPTOR,
        bits: frame.read_u64(0),
    }));
    // SAFETY: a complete global block literal that lives, like the class the
    // IMP goes on, for the rest of the process; its invoke function takes
    // the block and the receiver, as `imp_implementationWithBlock` requires.
    Ok(unsafe { (rt().imp_implementationWithBlock)(core::ptr::from_ref(block).cast()) })
}

/// `types` checked and split by `NSMethodSignature`, then narrowed to what
/// [`deliver`] can take and return, with its libffi call interface prepared.
/// `spelling` says whether the script wrote `types` or a protocol or
/// superclass declared them.
fn parse_types(
    method: String,
    class: DynClass,
    sel: Sel,
    types: &str,
    colons: usize,
    spelling: Spelling,
) -> Result<(Signature, CString)> {
    let invalid = |why: &dyn core::fmt::Display| {
        unsupported(
            &method,
            format!("type encoding {types:?} is not valid{why}"),
        )
    };
    let c_types = CString::new(types).map_err(|_| invalid(&""))?;
    let ns = dynamic::method_signature(types, invalid)?;
    let selector = rt().sel_name(sel);
    let mut sig = Signature::new(ns, sel, method, Family::of(&selector), spelling);
    dynamic::mark_bool_params(class, &selector, &mut sig);
    if spelling == Spelling::Runtime {
        dynamic::mark_char_slots(class, &selector, &mut sig);
    }
    dynamic::mark_ownership(class, &selector, &mut sig);
    if !sig.has_self_and_cmd() {
        return Err(unsupported(
            sig.method(),
            format!(
                "type encoding {types:?} must start with the return type followed by \"@:\" for the receiver and _cmd"
            ),
        ));
    }
    if sig.args.len() != colons {
        return Err(unsupported(
            sig.method(),
            format!(
                "type encoding {types:?} has {} argument(s) but the selector takes {colons}",
                sig.args.len()
            ),
        ));
    }
    for (index, enc) in sig.args.iter().enumerate() {
        let refused = match enc {
            Enc::Buffer(b) => Some(format!("{b} (a C array; a C string parameter is r*)")),
            Enc::Other(_) => Some(enc.to_string()),
            _ => None,
        };
        if let Some(refused) = refused {
            return Err(unsupported(
                sig.method(),
                format!("argument {index} type {refused} is not supported for a script method"),
            ));
        }
    }
    sig.check_return()?;
    if let Enc::CString | Enc::Out(_) | Enc::Buffer(_) | Enc::Pointer = sig.ret {
        return Err(unsupported(
            sig.method(),
            format!(
                "return type {} is not supported for a script method",
                sig.ret
            ),
        ));
    }
    sig.prepare();
    Ok((sig, c_types))
}

/// Whether `object` is a live instance (not a class object) of a script
/// class, or of a subclass of one, whose methods the class answers (not one
/// whose data is [`attach`]ed per instance).
pub fn defines_class_of(object: &DynObject) -> bool {
    if object.is_class() {
        return false;
    }
    let Ok(live) = object.live() else {
        return false;
    };
    script_classes(rt().class_of(live.as_id()))
        .next()
        .is_some_and(|entry| entry.owner.is_some())
}

/// Stores `data` on `object`, an instance of a script class whose methods
/// run on this thread, until the object deallocates (when it is dropped on
/// this thread). Once only, so a method running with the data in hand
/// cannot see it freed.
pub fn attach(object: &DynObject, data: Box<dyn Any>) -> Result<()> {
    load()?;
    let live = object.live()?;
    let Some(entry) = script_classes(rt().class_of(live.as_id())).next() else {
        return Err(Error::InvalidState(
            "only an instance of a class made with objc.defineClass() carries script data",
        ));
    };
    let owner = handoff::current();
    if entry.owner.is_some_and(|o| !core::ptr::eq(o, owner)) {
        return Err(Error::OtherThread(
            "script data can only be attached on the thread that defined the object's class",
        ));
    }
    let data = bun_core::heap::into_raw(Box::new(InstanceData { owner, data }));
    // SAFETY: every instance of the chain has the root's pointer ivar at
    // this offset. It is written null → data here, with a compare-exchange
    // so a second attach (from wherever) sees the first, and data → null
    // only by `dealloc`, when nothing else can reach the object.
    let installed = unsafe {
        let slot = &*live
            .as_obj()
            .byte_offset(entry.data_offset)
            .cast::<AtomicPtr<InstanceData>>();
        slot.compare_exchange(null_mut(), data, Ordering::Release, Ordering::Relaxed)
            .is_ok()
    };
    if !installed {
        // SAFETY: not installed, so still ours.
        drop(unsafe { bun_core::heap::take(data) });
        return Err(Error::InvalidState(
            "script data is already attached to this object",
        ));
    }
    Ok(())
}

/// The nearest ancestor of `class` whose `sel` is not `imp`: where a `super`
/// send from the script class that installed `imp` goes. Also yields that
/// script class (the last one walked that still inherits `imp`).
fn below_imp(class: Class, sel: Sel, imp: usize) -> Option<(Class, Class)> {
    let mut installed = class;
    loop {
        let base = rt().superclass(installed)?;
        if rt().method_implementation(base, sel) as usize != imp {
            return Some((installed, base));
        }
        installed = base;
    }
}

/// Whether `class` answers `forwardInvocation:` with something other than a
/// root class's implementation, which only raises "unrecognized selector".
fn forwards_beyond_root(class: Class, cmd: Sel) -> bool {
    let imp = rt().method_implementation(class, cmd);
    let root_imp = |root: Option<Class>| root.map(|c| rt().method_implementation(c, cmd));
    Some(imp) != root_imp(Some(NSObject::class()))
        && Some(imp) != root_imp(super::lookup_class(c"NSProxy"))
}

/// What `this`'s instances carry at the root's ivar: null, or what
/// [`attach`] leaked, which only `dealloc` frees.
///
/// # Safety
/// `this` is an instance of `entry`'s chain, valid for the duration of the
/// message it is being sent.
unsafe fn instance_data<'a>(this: Obj, entry: &Entry) -> Option<&'a InstanceData> {
    // SAFETY: per contract.
    unsafe {
        (*this
            .byte_offset(entry.data_offset)
            .cast::<AtomicPtr<InstanceData>>())
        .load(Ordering::Acquire)
        .as_ref()
    }
}

/// Answers one message to `this` (the receiver an IMP or `forwardInvocation:`
/// was entered with) for `method` of `entry` with its argument `frames`,
/// as the result laid out for the return type; zero when it cannot be
/// answered here and now. The function runs on the class's (else the
/// instance's) thread only: from another thread the call is handed over
/// when it wants nothing back, and refused (that thread is told; stderr,
/// once it is gone) otherwise. An instance-owned class with nothing
/// attached has nothing to run anywhere.
fn respond(
    this: Obj,
    entry: &'static Entry,
    method: &'static Method,
    class_method: bool,
    frames: &[Frame],
) -> Frame {
    let instance = if class_method {
        // The class object carries no data.
        None
    } else {
        // SAFETY: `this` is the receiver of the message being delivered, an
        // instance of the chain.
        unsafe { instance_data(this, entry) }
    };
    // A method that takes over a reference (an `init…` its receiver's,
    // alloc's +1; one the headers say so for an argument's or the
    // receiver's) and cannot run answers nil and lets that reference go, as
    // it would had the script returned null.
    let unanswered = || {
        let sig = &method.sig;
        if !class_method && sig.consumes_self() {
            // SAFETY: `this` is the receiver the frame was entered with,
            // which the caller handed over and nothing else will release.
            unsafe { (rt().objc_release)(this) };
        }
        for (index, frame) in frames.iter().enumerate() {
            let object = frame.read_word() as Obj;
            if sig.consumes(index) && !object.is_null() {
                // SAFETY: a live object the caller handed a reference to.
                unsafe { (rt().objc_release)(object) };
            }
        }
        Frame::new()
    };
    let Some(owner) = entry.owner.or_else(|| instance.map(|i| i.owner)) else {
        return unanswered();
    };
    if !owner.is_current() {
        let sig = &method.sig;
        match HandedOver::refused(&sig.ret, &sig.args) {
            Some(why) => owner.wrong_thread(sig.method().to_owned(), why),
            None => {
                // A receiver part way through deallocating cannot be kept.
                // SAFETY: `this` is valid for the message's duration;
                // `retainWeakReference` (`B@:`) takes a reference when it
                // answers YES; a class object answers retain with itself.
                let kept = unsafe {
                    if class_method {
                        Some((rt().objc_retain)(this))
                    } else {
                        rt().send::<Bool, _>(this, sel!("retainWeakReference"), ())
                            .get()
                            .then_some(this)
                    }
                };
                if let Some(kept) = kept {
                    // SAFETY: `kept` is +1; `frames` hold `sig.args`' types, live now.
                    let call = unsafe { HandedOver::new(kept, &sig.args, frames) };
                    let later = Later {
                        call,
                        entry,
                        method,
                        class_method,
                    };
                    owner.hand_over(sig.method(), Box::new(move || later.deliver()));
                }
            }
        }
        return unanswered();
    }
    if owner.retired() {
        return unanswered();
    }
    match deliver(
        this,
        entry,
        method,
        class_method,
        frames,
        instance.map(|i| &*i.data),
    ) {
        Ok(out) => out,
        Err(err) => {
            entry.handler.report(err);
            Frame::new()
        }
    }
}

/// A message handed over from another thread, to [`deliver`] on this one.
struct Later {
    call: HandedOver,
    entry: &'static Entry,
    method: &'static Method,
    class_method: bool,
}

// SAFETY: `entry` and `method` are leaked and never change once published;
// what is not thread-safe behind them (the handler) is only touched by
// `deliver`, on the owner's thread, which is where this is sent to run.
unsafe impl Send for Later {}

impl Later {
    fn deliver(self) {
        let Later {
            call,
            entry,
            method,
            class_method,
        } = self;
        let this = call.receiver;
        let instance = if class_method {
            None
        } else {
            // SAFETY: kept alive by `call`, on the owner's thread now.
            unsafe { instance_data(this, entry) }
        };
        if let Err(err) = deliver(
            this,
            entry,
            method,
            class_method,
            &call.frames,
            instance.map(|i| &*i.data),
        ) {
            entry.handler.report(err);
        }
        drop(call);
    }
}

extern "C" fn forward_invocation(this: Obj, cmd: Sel, invocation: Obj) {
    // SAFETY: `invocation` is the live NSInvocation forwardInvocation: was sent with.
    let Some(invocation) = (unsafe { Id::retain(invocation).map(|id| NSInvocation::from_id(id)) })
    else {
        return;
    };
    let Some(sel) = invocation.selector() else {
        return;
    };
    // SAFETY: `this` is the receiver, which has not finished deallocating
    // while it is being sent messages.
    let class = unsafe { rt().class_of_raw(this) };
    let Some((entry, method)) = script_method(class, sel) else {
        // A selector no script class defines but something up the chain gave
        // a signature for: a framework superclass that forwards for real
        // decides what that means; the root classes would only raise.
        let ours = forward_invocation as extern "C" fn(Obj, Sel, Obj) as usize;
        if let Some((_, base)) = below_imp(class, cmd, ours)
            && forwards_beyond_root(base, cmd)
        {
            // SAFETY: `base` implements or inherits forwardInvocation: as
            // `v@:@`; receiver and argument are the ones we were called with.
            let imp: extern "C" fn(Obj, Sel, Obj) =
                unsafe { core::mem::transmute(rt().method_implementation(base, cmd)) };
            imp(this, cmd, invocation.as_obj());
        }
        return;
    };
    let sig = &method.sig;
    // An invocation built by hand can carry any signature; reading an
    // argument it does not have would raise inside this frame.
    let carried = invocation.method_signature();
    if carried.number_of_arguments() != sig.args.len() + 2
        || carried.method_return_length() != sig.ret_len()
    {
        entry.handler.report(unsupported(
            sig.method(),
            format!(
                "was sent an invocation whose signature takes {} argument(s) and returns {} bytes; the method takes {} and returns {}",
                carried.number_of_arguments().saturating_sub(2),
                carried.method_return_length(),
                sig.args.len(),
                sig.ret_len()
            ),
        ));
        return;
    }
    let frames: Frames = (0..sig.args.len())
        .map(|i| {
            let mut frame = Frame::new();
            invocation.get_argument_raw(frame.as_mut_ptr(), (i + 2) as isize);
            frame
        })
        .collect();
    let out = respond(this, entry, method, false, &frames);
    if sig.ret != Enc::Void {
        invocation.set_return_value_raw(out.as_ptr());
    }
}

/// Runs the script method with the arguments in `frames` and lays its
/// result out for the return type; anything short of that is an `Err` (and
/// the caller answers zero).
fn deliver(
    this: Obj,
    entry: &Entry,
    method: &Method,
    class_method: bool,
    frames: &[Frame],
    instance: Option<&dyn Any>,
) -> Result<Frame> {
    let sig = &method.sig;
    // `this` is the receiver of the message being delivered, valid for its
    // duration.
    let receiver = if class_method {
        // SAFETY: as above; a class object is never deallocated and retain
        // on one is free.
        unsafe { DynObject::retain(this) }
    } else if sig.consumes_self() {
        // An `init…` (or a method declared to replace its receiver) is
        // handed its receiver's reference to consume: pass on to the
        // superclass's, keep in what it returns, or let go.
        // SAFETY: as above; so that reference becomes the wrapper's.
        unsafe { DynObject::from_retained(this) }
    } else {
        // A receiver part way through deallocating (its superclass's dealloc
        // sending something the script overrides) cannot be kept alive for
        // the script, so the script never sees it.
        // SAFETY: as above; `retainWeakReference` is `B@:` on both root
        // classes and has taken a reference when it answers YES.
        let retained: Bool = unsafe { rt().send(this, sel!("retainWeakReference"), ()) };
        if !retained.get() {
            return Ok(Frame::new());
        }
        // SAFETY: the reference just taken moves into the wrapper.
        unsafe { DynObject::from_retained(this) }
    };
    let Some(receiver) = receiver else {
        return Ok(Frame::new());
    };
    let mut args = Vec::with_capacity(sig.args.len());
    for (index, (enc, frame)) in sig.args.iter().zip(frames).enumerate() {
        args.push(match enc {
            Enc::Out(pointee) => read_out(sig.method(), *pointee, frame)?,
            // An argument the method takes over comes with the caller's
            // reference, which the wrapper keeps as its own.
            _ => decode(sig.method(), enc, sig.consumes(index), frame)?,
        });
    }
    let _initializing = (sig.family == Family::Init).then(|| Initializing::enter(this));
    let reply = entry.handler.call(Call {
        receiver,
        class: DynClass(entry.class),
        index: method.index,
        selector: &method.selector,
        method: sig.method(),
        args,
        params: &sig.args,
        ret: &sig.ret,
        instance,
    });
    for (index, value) in &reply.outs {
        if let (Some(Enc::Out(pointee)), Some(frame)) = (sig.args.get(*index), frames.get(*index)) {
            write_out(sig.method(), *index, *pointee, frame, value)?;
        }
    }
    let mut frame = Frame::new();
    if let Some(result) = reply.value
        && sig.ret != Enc::Void
    {
        encode_result(sig.method(), &sig.ret, sig.family, &result, &mut frame)?;
    }
    Ok(frame)
}

extern "C" fn dealloc(this: Obj, cmd: Sel) {
    let ours = dealloc as extern "C" fn(Obj, Sel) as usize;
    // SAFETY: an object in dealloc is still a valid pointer with its class intact.
    let class = unsafe { rt().class_of_raw(this) };
    let Some((root, base)) = below_imp(class, cmd, ours) else {
        unreachable!("dealloc override on a root class");
    };
    if let Some(offset) = ivar_offset(root, IVAR) {
        // SAFETY: the root script class declares this pointer ivar; it is
        // null or what `attach` leaked, and nothing else can reach the
        // object any more. The script's value is let go on its thread.
        unsafe {
            let slot = &*this.byte_offset(offset).cast::<AtomicPtr<InstanceData>>();
            let data = slot.swap(null_mut(), Ordering::Acquire);
            if !data.is_null() {
                handoff::free_on_owner((*data).owner, data);
            }
        }
    }
    // SAFETY: `base` is a framework class, whose dealloc is `v@:`.
    let imp: extern "C" fn(Obj, Sel) =
        unsafe { core::mem::transmute(rt().method_implementation(base, cmd)) };
    imp(this, cmd);
}
