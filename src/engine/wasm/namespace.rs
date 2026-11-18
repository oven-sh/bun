//! The `WebAssembly` object, and the classes that a realm has one of.

use bun_engine_vm::ic::KeptResult;
use bun_engine_vm::{
    Attributes, FieldArray, Intrinsic, JsCell, NativeFunction, RealmSlot, options,
    try_function_realm,
};

use crate::errors::{self, Kind};
use crate::prelude::*;
use crate::{
    compile, exception, function, global, instance, memory, module, module_record, streaming,
    suspension, table, tag,
};

macro_rules! slots {
    ($($($name:ident),+ => $initialize:expr;)*) => {
        /// What the `WebAssembly` object of a realm holds. Those in a row are made together, when one is asked for.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(usize)]
        pub(crate) enum Slot {
            $($($name,)+)*
        }

        impl Slot {
            const COUNT: usize = [$($(stringify!($name),)+)*].len();

            fn initialize(self, cx: &Cx, namespace: &Namespace) {
                let initialize: fn(&Cx, &Namespace) = match self {
                    $($(Slot::$name)|+ => $initialize,)*
                };
                initialize(cx, namespace);
            }
        }
    };
}

slots! {
    ModuleConstructor, ModuleShape => module::initialize;
    InstanceConstructor, InstanceShape => instance::initialize;
    MemoryConstructor, MemoryShape => memory::initialize;
    TableConstructor, TableShape => table::initialize;
    GlobalConstructor, GlobalShape => global::initialize;
    TagConstructor, TagShape => tag::initialize;
    ScriptTag => tag::initialize_script_tag;
    ExceptionConstructor, ExceptionShape => exception::initialize;
    FunctionShape => function::initialize;
    SuspendingConstructor, SuspendingShape => suspension::initialize;
    Resumer => suspension::initialize_resumer;
    StreamingRequestShape => streaming::initialize;
    ModuleRecordShape => module_record::initialize;
    CompileErrorConstructor, CompileErrorShape => |cx, it| errors::initialize(cx, it, Kind::Compile);
    LinkErrorConstructor, LinkErrorShape => |cx, it| errors::initialize(cx, it, Kind::Link);
    RuntimeErrorConstructor, RuntimeErrorShape => |cx, it| errors::initialize(cx, it, Kind::Runtime);
    SuspendErrorConstructor, SuspendErrorShape => |cx, it| errors::initialize(cx, it, Kind::Suspend);
}

macro_rules! class {
    ($name:ident, $slot:ident) => {
        StaticProperty::made(names::$name, |cx, _| {
            Namespace::of(cx).get(cx, Slot::$slot).as_value()
        })
    };
}

static_table!(static NAMESPACE_PROPERTIES = [
    class!(CompileError, CompileErrorConstructor),
    class!(Exception, ExceptionConstructor),
    class!(Global, GlobalConstructor),
    class!(Instance, InstanceConstructor),
    class!(LinkError, LinkErrorConstructor),
    class!(Memory, MemoryConstructor),
    class!(Module, ModuleConstructor),
    class!(RuntimeError, RuntimeErrorConstructor),
    class!(Table, TableConstructor),
    class!(Tag, TagConstructor),
    member(StaticProperty::function(names::compile, compile::compile, 1)),
    member(StaticProperty::function(names::instantiate, compile::instantiate, 1)),
    member(StaticProperty::function(names::validate, compile::validate, 1)),
    StaticProperty::position_of(names::compileStreaming),
    StaticProperty::position_of(names::instantiateStreaming),
    member(StaticProperty::getter(names::JSTag, tag::get_script_tag)),
    member(StaticProperty::function(names::promising, suspension::promising, 0)),
    class!(Suspending, SuspendingConstructor),
    class!(SuspendError, SuspendErrorConstructor),
    StaticProperty::string(symbols::toStringTag, names::WebAssembly),
]);

#[cell(name = "WebAssembly", static_table = NAMESPACE_PROPERTIES)]
pub(crate) struct Namespace {
    base: JsObject,
    classes: FieldArray<Option<Gc<JsCell>>, { Slot::COUNT }>,
}

impl Namespace {
    fn create(cx: &Cx) -> Gc<Namespace> {
        let spec = ShapeSpec::of::<Namespace>();
        let prototype = cx.object_prototype().into();
        let shape = Shape::create_dictionary(cx, Some(cx.global()), prototype, spec);
        let namespace = cx.allocate::<Namespace>(NamespaceInit {
            base: JsObjectInit::new(cx, shape),
            classes: [None; Slot::COUNT],
        });
        let hooks = cx.global().hooks();
        if hooks.compile_wasm_streaming.is_some() {
            let name = names::compileStreaming;
            define_method(cx, &namespace, name, 1, streaming::compile);
        }
        if hooks.instantiate_wasm_streaming.is_some() {
            let name = names::instantiateStreaming;
            define_method(cx, &namespace, name, 1, streaming::instantiate);
        }
        namespace
    }

    /// The one of the realm of `cx`.
    pub(crate) fn of(cx: &Cx) -> Gc<Namespace> {
        cx.webassembly_object().cast()
    }

    pub(crate) fn get(&self, cx: &Cx, slot: Slot) -> Gc<JsCell> {
        if let Some(cell) = self.classes().at(slot as usize) {
            return cell;
        }
        slot.initialize(cx, self);
        self.classes().at(slot as usize).expect("it was just made")
    }

    pub(crate) fn shape(&self, cx: &Cx, slot: Slot) -> Gc<Shape> {
        self.get(cx, slot).cast()
    }

    pub(crate) fn put(&self, slot: Slot, value: Gc<impl CellKind>) {
        self.classes().set(slot as usize, Some(value.cell()));
    }
}

fn define_method(
    cx: &Cx,
    object: &JsObject,
    name: PropertyName<'_>,
    length: u32,
    function: NativeFunction,
) {
    let (intrinsic, attributes) = (Intrinsic::None, Attributes::NONE);
    object.put_direct_native_function(cx, name, length, function, intrinsic, attributes);
}

/// The method `type` of a prototype, if types are reflected.
pub(crate) fn define_type_method(cx: &Cx, prototype: &JsObject, function: NativeFunction) {
    if options().use_wasm_type_reflection {
        define_method(cx, prototype, names::r#type, 0, function);
    }
}

/// The shape of what a constructor makes.
pub(crate) fn shape_for_new_target(
    cx: &mut Cx,
    frame: &CallFrame,
    slot: Slot,
) -> JsResult<Gc<Shape>> {
    let callee = frame.callee();
    let Some(new_target) = (frame.new_target().as_object()).filter(|it| !it.is_same(&callee))
    else {
        return Ok(Namespace::of(cx).shape(cx, slot));
    };
    let realm = try_function_realm(cx, new_target).unwrap_or_else(|| cx.global());
    let in_realm = cx.in_realm_shared(realm);
    let base = Namespace::of(in_realm).shape(in_realm, slot);
    cx.subclass_shape(new_target, base)
}

/// `Hooks::kept_result_of_wasm_getter`
pub fn kept_result_of_getter(getter: usize, receiver: &JsObject) -> Option<KeptResult> {
    instance::kept_result(getter, receiver).or_else(|| memory::kept_result(getter, receiver))
}

/// False if the slot belongs to another crate.
pub fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    if slot == RealmSlot::webassembly_object {
        let namespace = Namespace::create(cx);
        cx.global().init_webassembly_object(namespace.upcast());
    }
    slot == RealmSlot::webassembly_object
}
