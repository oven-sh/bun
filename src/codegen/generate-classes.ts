// @ts-nocheck
import path from "path";
import type { Field, ClassDefinition } from "./class-definitions";
import { writeIfNotChanged } from "./helpers";
import { camelCase, pascalCase } from "change-case";

const files = process.argv.slice(2);
const outBase = files.pop();

const CommonIdentifiers = {
  "name": true,
};
function toIdentifier(propertyName) {
  if (CommonIdentifiers[propertyName]) {
    return `vm.propertyNames->${propertyName}`;
  }

  return `Identifier::fromString(vm, ${JSON.stringify(propertyName)}_s)`;
}

function symbolName(typeName, name) {
  return `${typeName}__${name.replaceAll("@@", "")}`;
}

function protoSymbolName(typeName, name) {
  return `${typeName}Prototype__${name.replaceAll("@@", "")}`;
}

function classSymbolName(typeName, name) {
  return `${typeName}Class__${name.replaceAll("@@", "")}`;
}

function subspaceFor(typeName) {
  return `m_subspaceFor${typeName}`;
}

function clientSubspaceFor(typeName) {
  return `m_clientSubspaceFor${typeName}`;
}

function prototypeName(typeName) {
  return `JS${typeName}Prototype`;
}

function className(typeName) {
  return `JS${typeName}`;
}

function constructorName(typeName) {
  return `JS${typeName}Constructor`;
}

function DOMJITName(fnName) {
  return `${fnName}WithoutTypeChecks`;
}

function argTypeName(arg) {
  return {
    ["bool"]: "bool",
    ["int"]: "int32_t",
    ["JSUint8Array"]: "JSC::JSUint8Array*",
    ["JSString"]: "JSC::JSString*",
    ["JSValue"]: "JSC::JSValue",
  }[arg];
}

function DOMJITType(type) {
  return {
    ["bool"]: "JSC::SpecBoolean",
    ["int"]: "JSC::SpecInt32Only",
    ["JSUint8Array"]: "JSC::SpecUint8Array",
    ["JSString"]: "JSC::SpecString",
    ["JSValue"]: "JSC::SpecHeapTop",
  }[type];
}

function ZigDOMJITArgType(type) {
  return {
    ["bool"]: "bool",
    ["int"]: "i32",
    ["JSUint8Array"]: "*JSC.JSUint8Array",
    ["JSString"]: "*JSC.JSString",
    ["JSValue"]: "JSC.JSValue",
  }[type];
}

function ZigDOMJITFunctionType(thisName, { args, returns }) {
  return `fn (*${thisName}, *JSC.JSGlobalObject, ${args
    .map(ZigDOMJITArgType)
    .join(", ")}) callconv(.C) ${ZigDOMJITArgType("JSValue")}`;
}

function DOMJITReturnType(type) {
  return {
    ["bool"]: "bool",
    ["int"]: "int32_t",
    ["JSUint8Array"]: "JSC::JSUint8Array*",
    ["JSString"]: "JSString*",
    ["JSValue"]: "EncodedJSValue",
  }[type];
}

function DOMJITFunctionDeclaration(jsClassName, fnName, symName, { args, returns, pure = false }) {
  const argNames = args.map((arg, i) => `${argTypeName(arg)} arg${i}`);
  const formattedArgs = argNames.length > 0 ? `, ${argNames.join(", ")}` : "";
  const domJITArgs = args.length > 0 ? `, ${args.map(DOMJITType).join(", ")}` : "";
  return `
  extern "C" JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(${DOMJITName(
    fnName,
  )}Wrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue${formattedArgs}));
  extern "C" EncodedJSValue ${DOMJITName(symName)}(void* ptr, JSC::JSGlobalObject * lexicalGlobalObject${formattedArgs});

  static const JSC::DOMJIT::Signature DOMJITSignatureFor${fnName}(${DOMJITName(fnName)}Wrapper,
  ${jsClassName}::info(),
  ${
    pure
      ? "JSC::DOMJIT::Effect::forPure()"
      : "JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top())"
  },
  ${returns === "JSString" ? "JSC::SpecString" : DOMJITType("JSValue")}${domJITArgs});
`.trim();
}

function DOMJITFunctionDefinition(jsClassName, fnName, symName, { args }) {
  const argNames = args.map((arg, i) => `${argTypeName(arg)} arg${i}`);
  const formattedArgs = argNames.length > 0 ? `, ${argNames.join(", ")}` : "";
  const retArgs = argNames.length > 0 ? `, ${args.map((b, i) => "arg" + i).join(", ")}` : "";

  return `
JSC_DEFINE_JIT_OPERATION(${DOMJITName(
    fnName,
  )}Wrapper, EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue${formattedArgs}))
{
    VM& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    return ${DOMJITName(symName)}(reinterpret_cast<${jsClassName}*>(thisValue)->wrapped(), lexicalGlobalObject${retArgs});
}
`;
}

function appendSymbols(to: Map<string, string>, symbolName: (name: string) => string, prop) {
  var { defaultValue, getter, setter, accesosr, fn, DOMJIT, cache } = prop;

  if (accesosr) {
    getter = accesosr.getter;
    setter = accesosr.setter;
  }

  if (getter && !to.get(getter)) {
    to.set(getter, symbolName(getter));
  }

  if (setter && !to.get(setter)) {
    to.set(setter, symbolName(setter));
  }

  if (fn && !to.get(fn)) {
    if (DOMJIT) {
      to.set(DOMJITName(fn), symbolName(DOMJITName(fn)));
    }
    to.set(fn, symbolName(fn));
  }
}
function propRow(
  symbolName: (a: string, b: string) => string,
  typeName: string,
  name: string,
  prop: Field,
  isWrapped = true,
  defaultPropertyAttributes,
  supportsObjectCreate = false,
) {
  var {
    defaultValue,
    getter,
    setter,
    fn,
    accesosr,
    fn,
    length = 0,
    cache,
    DOMJIT,
    enumerable = true,
    configurable = false,
    value,
    builtin,
  } = (defaultPropertyAttributes ? Object.assign({}, defaultPropertyAttributes, prop) : prop) as any;

  var extraPropertyAttributes = "";
  if (!enumerable) {
    extraPropertyAttributes += " | PropertyAttribute::DontEnum";
  }

  if (!configurable) {
    extraPropertyAttributes += " | PropertyAttribute::DontDelete";
  }

  if (accesosr) {
    getter = accesosr.getter;
    setter = accesosr.setter;
  }

  var symbol = symbolName(typeName, name);

  if (isWrapped) {
    if (getter) {
      getter = symbol + "GetterWrap";
    }
    if (setter) {
      setter = symbol + "SetterWrap";
    }
    if (fn) {
      fn = symbol + "Callback";
    }
  } else {
    if (getter) {
      getter = symbolName(typeName, getter);
    }
    if (setter) {
      setter = symbolName(typeName, setter);
    }
    if (fn) {
      fn = symbolName(typeName, fn);
    }
  }

  if (builtin !== undefined) {
    if (typeof builtin !== "string") throw new Error('"builtin" should be string');
    return `
{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, ${builtin}, ${
      length || 0
    } } }
`.trim();
  } else if (fn !== undefined) {
    if (DOMJIT) {
      // { "getElementById"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DOMJITFunction), NoIntrinsic, { HashTableValue::DOMJITFunctionType, jsTestDOMJITPrototypeFunction_getElementById, &DOMJITSignatureForTestDOMJITGetElementById } },
      return `
      { "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DOMJITFunction${extraPropertyAttributes}), NoIntrinsic, { HashTableValue::DOMJITFunctionType, ${fn}, &DOMJITSignatureFor${symbol} } }
      `.trim();
    }
    return `
{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function${extraPropertyAttributes}), NoIntrinsic, { HashTableValue::NativeFunctionType, ${fn}, ${
      length || 0
    } } }
`.trim();
  } else if (getter && setter) {
    return `

{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute${extraPropertyAttributes}), NoIntrinsic, { HashTableValue::GetterSetterType, ${getter}, ${setter} } }
`.trim();
  } else if (defaultValue) {
  } else if (getter && !supportsObjectCreate) {
    return `{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute${extraPropertyAttributes}), NoIntrinsic, { HashTableValue::GetterSetterType, ${getter}, 0 } }
`.trim();
  } else if (getter && supportsObjectCreate) {
    setter = getter.replace("Get", "Set");
    return `{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor ${extraPropertyAttributes}), NoIntrinsic, { HashTableValue::GetterSetterType, &${getter}, &${setter} } }
`.trim();
  } else if (setter) {
    return `{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute${extraPropertyAttributes}), NoIntrinsic, { HashTableValue::GetterSetterType, 0, ${setter} } }
  `.trim();
  }

  throw "Unsupported property";
}

export function generateHashTable(nameToUse, symbolName, typeName, obj, props = {}, wrapped) {
  const rows = [];
  let defaultPropertyAttributes = undefined;

  if ("enumerable" in obj) {
    defaultPropertyAttributes ||= {};
    defaultPropertyAttributes.enumerable = obj.enumerable;
  }

  if ("configurable" in obj) {
    defaultPropertyAttributes ||= {};
    defaultPropertyAttributes.configurable = obj.configurable;
  }

  for (const name in props) {
    if ("privateSymbol" in props[name] || "internal" in props[name] || "value" in props[name]) continue;
    if (name.startsWith("@@")) continue;

    rows.push(
      propRow(
        symbolName,
        typeName,
        name,
        props[name],
        wrapped,
        defaultPropertyAttributes,
        obj.supportsObjectCreate || false,
      ),
    );
  }

  if (rows.length === 0) {
    return "";
  }
  return `
  static const HashTableValue ${nameToUse}TableValues[${rows.length}] = {${"\n" + rows.join("  ,\n") + "\n"}};
`;
}

function generatePrototype(typeName, obj) {
  const proto = prototypeName(typeName);
  const { proto: protoFields } = obj;
  var specialSymbols = "";

  var staticPrototypeValues = "";

  for (const name in protoFields) {
    if ("value" in protoFields[name]) {
      const { value } = protoFields[name];
      staticPrototypeValues += `
      this->putDirect(vm, ${toIdentifier(name)}, jsString(vm, String(${JSON.stringify(
        value,
      )}_s)), PropertyAttribute::ReadOnly | 0);`;
    }

    if (protoFields[name].privateSymbol !== undefined) {
      const privateSymbol = protoFields[name].privateSymbol;
      const fn = protoFields[name].fn;
      if (!fn) throw Error(`(field: ${name}) private field needs 'fn' key `);

      specialSymbols += `
    this->putDirect(vm, WebCore::clientData(vm)->builtinNames().${privateSymbol}PrivateName(), JSFunction::create(vm, globalObject, ${
      protoFields[name].length || 0
    }, String("${fn}"_s), ${protoSymbolName(
      typeName,
      fn,
    )}Callback, ImplementationVisibility::Private), PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | 0);`;
      continue;
    }

    if (!name.startsWith("@@")) {
      continue;
    }

    const symbol = name.slice(2);

    specialSymbols += `
    this->putDirect(vm, vm.propertyNames->${symbol}Symbol, JSFunction::create(vm, globalObject, 1, String("${symbol}"_s), ${protoSymbolName(
      typeName,
      symbol,
    )}Callback, ImplementationVisibility::Public), PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | 0);`;
  }

  return `
${
  obj.construct
    ? `extern "C" void* ${classSymbolName(typeName, "construct")}(JSC::JSGlobalObject*, JSC::CallFrame*);
JSC_DECLARE_CUSTOM_GETTER(js${typeName}Constructor);`
    : ""
}

${
  obj.structuredClone
    ? `extern "C" void ${symbolName(
        typeName,
        "onStructuredCloneSerialize",
      )}(void*, JSC::JSGlobalObject*, void*, void (*) (CloneSerializer*, const uint8_t*, uint32_t));`
    : ""
}

${
  obj.structuredClone
    ? `extern "C" JSC::EncodedJSValue ${symbolName(
        typeName,
        "onStructuredCloneDeserialize",
      )}(JSC::JSGlobalObject*, const uint8_t*, const uint8_t*);`
    : ""
}

${"finalize" in obj ? `extern "C" void ${classSymbolName(typeName, "finalize")}(void*);` : ""}
${obj.call ? `extern "C" JSC_DECLARE_HOST_FUNCTION(${classSymbolName(typeName, "call")});` : ""}

${renderDecls(protoSymbolName, typeName, protoFields, obj.supportsObjectCreate || false)}
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(${proto}, ${proto}::Base);

${generateHashTable(
  prototypeName(typeName),
  protoSymbolName,
  typeName,
  obj,

  protoFields,
  true,
)}


const ClassInfo ${proto}::s_info = { "${typeName}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${proto}) };

${renderFieldsImpl(protoSymbolName, typeName, obj, protoFields, obj.values || [])}

void ${proto}::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ${
      Object.keys(protoFields).length > 0
        ? `reifyStaticProperties(vm, ${className(typeName)}::info(), ${proto}TableValues, *this);`
        : ""
    }${specialSymbols}${staticPrototypeValues}
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}



`;
}

function generatePrototypeHeader(typename) {
  const proto = prototypeName(typename);

  return `
  class ${proto} final : public JSC::JSNonFinalObject {
    public:
        using Base = JSC::JSNonFinalObject;

        static ${proto}* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
        {
            ${proto}* ptr = new (NotNull, JSC::allocateCell<${proto}>(vm)) ${proto}(vm, globalObject, structure);
            ptr->finishCreation(vm, globalObject);
            return ptr;
        }

        DECLARE_INFO;
        template<typename CellType, JSC::SubspaceAccess>
        static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
        {
            STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(${proto}, Base);
            return &vm.plainObjectSpace();
        }
        static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
        {
            return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        }

    private:
        ${proto}(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
            : Base(vm, structure)
        {
        }

        void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
    };`;
}

function generateConstructorHeader(typeName) {
  const name = constructorName(typeName);

  // we use a single shared isosubspace for constructors since they will rarely
  // ever be created multiple times per VM and have no fields themselves
  return `
  class ${name} final : public JSC::InternalFunction {
    public:
        using Base = JSC::InternalFunction;
        static ${name}* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, ${prototypeName(
          typeName,
        )}* prototype);

        static constexpr unsigned StructureFlags = Base::StructureFlags;
        static constexpr bool needsDestruction = false;

        static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
        {
            return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
        }

        template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
        {
          if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

          return WebCore::subspaceForImpl<${name}, WebCore::UseCustomHeapCellType::No>(
              vm,
              [](auto& spaces) { return spaces.${clientSubspaceFor("BunClass")}Constructor.get(); },
              [](auto& spaces, auto&& space) { spaces.${clientSubspaceFor("BunClass")}Constructor = std::forward<decltype(space)>(space); },
              [](auto& spaces) { return spaces.${subspaceFor("BunClass")}Constructor.get(); },
              [](auto& spaces, auto&& space) { spaces.${subspaceFor("BunClass")}Constructor = std::forward<decltype(space)>(space); });
        }


        void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, ${prototypeName(typeName)}* prototype);

        // Must be defined for each specialization class.
        static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);

        DECLARE_EXPORT_INFO;
    private:
        ${name}(JSC::VM& vm, JSC::Structure* structure);
        void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, ${prototypeName(typeName)}* prototype);
    };

    `;
}

function generateConstructorImpl(typeName, obj: ClassDefinition) {
  const name = constructorName(typeName);
  const { klass: fields } = obj;
  const hashTable =
    Object.keys(fields).length > 0 ? generateHashTable(name, classSymbolName, typeName, obj, fields, false) : "";

  const hashTableIdentifier = hashTable.length ? `${name}TableValues` : "";
  return `
${obj.estimatedSize ? `extern "C" size_t ${symbolName(typeName, "estimatedSize")}(void* ptr);` : ""}
${renderStaticDecls(classSymbolName, typeName, fields, obj.supportsObjectCreate || false)}
${hashTable}

void ${name}::finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, ${prototypeName(typeName)}* prototype)
{
    Base::finishCreation(vm, 0, "${typeName}"_s, PropertyAdditionMode::WithoutStructureTransition);
    ${hashTableIdentifier.length ? `reifyStaticProperties(vm, &${name}::s_info, ${hashTableIdentifier}, *this);` : ""}
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

${name}::${name}(JSC::VM& vm, JSC::Structure* structure) : Base(vm, structure, ${
    obj.call ? classSymbolName(typeName, "call") : "construct"
  }, construct) {

  }

${name}* ${name}::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, ${prototypeName(
    typeName,
  )}* prototype) {
    ${name}* ptr = new (NotNull, JSC::allocateCell<${name}>(vm)) ${name}(vm, structure);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}


JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${name}::construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::VM &vm = globalObject->vm();
    JSObject* newTarget = asObject(callFrame->newTarget());
    auto* constructor = globalObject->${className(typeName)}Constructor();
    Structure* structure = globalObject->${className(typeName)}Structure();
    if (constructor != newTarget) {
      auto scope = DECLARE_THROW_SCOPE(vm);

      auto* functionGlobalObject = reinterpret_cast<Zig::GlobalObject*>(
        // ShadowRealm functions belong to a different global object.
        getFunctionRealm(globalObject, newTarget)
      );
      RETURN_IF_EXCEPTION(scope, {});
      structure = InternalFunction::createSubclassStructure(
        globalObject,
        newTarget,
        functionGlobalObject->${className(typeName)}Structure()
      );
    }

    void* ptr = ${classSymbolName(typeName, "construct")}(globalObject, callFrame);

    if (UNLIKELY(!ptr)) {
      return JSValue::encode(JSC::jsUndefined());
    }

    ${className(typeName)}* instance = ${className(typeName)}::create(vm, globalObject, structure, ptr);
  ${
    obj.estimatedSize
      ? `vm.heap.reportExtraMemoryAllocated(instance, ${symbolName(obj.name, "estimatedSize")}(instance->wrapped()));`
      : ""
  }

    return JSValue::encode(instance);
}

void ${name}::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, ${prototypeName(typeName)}* prototype)
{

}

const ClassInfo ${name}::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${name}) };

${
  !obj.noConstructor
    ? `
  extern "C" EncodedJSValue ${typeName}__getConstructor(Zig::GlobalObject* globalObject) {
    return JSValue::encode(globalObject->${className(typeName)}Constructor());
  }`
    : ""
}


      `;
}

function renderCachedFieldsHeader(typeName, klass, proto, values) {
  const rows: string[] = [];
  for (const name in klass) {
    if (("cache" in klass[name] && klass[name].cache === true) || klass[name]?.internal) {
      rows.push(`mutable JSC::WriteBarrier<JSC::Unknown> m_${name};`);
    }
  }

  for (const name in proto) {
    if (proto[name]?.cache === true || klass[name]?.internal) {
      rows.push(`mutable JSC::WriteBarrier<JSC::Unknown> m_${name};`);
    }
  }

  for (const name of values) {
    rows.push(`mutable JSC::WriteBarrier<JSC::Unknown> m_${name};`);
  }

  return rows.join("\n");
}

function renderCallbacksHeader(typeName, callbacks: Record<string, string>) {
  const rows: string[] = [];
  for (const name in callbacks) {
    rows.push(`mutable WriteBarrier<JSObject> m_callback_${name};`);
  }

  return rows.join("\n");
}

function renderCallbacksCppImpl(typeName, callbacks: Record<string, string>) {
  const rows: string[] = [];
  if (Object.keys(callbacks).length === 0) return "";
  for (const name in callbacks) {
    rows.push(
      `
  extern "C" EncodedJSValue ${symbolName(typeName, "_callback_get_" + name)}(JSC::EncodedJSValue encodedThisValue) {
    auto* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
    return JSValue::encode(thisObject->m_callback_${name}.get());
  }

  extern "C" void ${symbolName(typeName, "_callback_set_" + name)}(JSC::EncodedJSValue encodedThisValue, JSC::EncodedJSValue encodedCallback) {
    auto* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
    JSValue callback = JSValue::decode(encodedCallback);
#if ASSERT_ENABLED
    if (!callback.isEmpty()) {
      ASSERT(callback.isObject());
      ASSERT(callback.isCallable());
    }
#endif
    if (callback.isEmpty()) {
        thisObject->m_callback_${name}.clear();
    } else {
        thisObject->m_callback_${name}.set(thisObject->vm(), thisObject, callback.getObject());
    }
  }
      `,
    );
  }

  rows.push(`
  extern "C" void ${symbolName(typeName, "_setAllCallbacks")}(JSC::EncodedJSValue encodedThisValue, ${Object.keys(
    callbacks,
  )
    .map((_, i) => `JSC::EncodedJSValue encodedCallback${i}`)
    .join(", ")}) {
    auto* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
    ${Object.keys(callbacks)
      .map(
        (name, i) => `
      JSValue callback${i} = JSValue::decode(encodedCallback${i});
      if (!callback${i}.isEmpty()) {
        thisObject->m_callback_${name}.set(thisObject->vm(), thisObject, callback${i}.getObject());
      }
      `,
      )
      .join("\n")}
  }

`);

  return rows.join("\n");
}

function renderCallbacksZig(typeName, callbacks: Record<string, string>) {
  if (Object.keys(callbacks).length === 0) return "";

  var out =
    "\n" +
    `pub const Callbacks = struct {
      instance: JSC.JSValue,` +
    "\n";

  for (const name in callbacks) {
    const get = symbolName(typeName, "_callback_get_" + name);
    const set = symbolName(typeName, "_callback_set_" + name);
    out += `
      extern fn ${get}(JSC.JSValue) JSC.JSValue;
      extern fn ${set}(JSC.JSValue, JSC.JSValue) void;
      pub const ${pascalCase(name)}Callback = JSC.Codegen.CallbackWrapper(${get}, ${set});
      pub fn ${camelCase(name)}(cb: @This(), thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, args: []const JSC.JSValue) ?JSC.JSValue {
        return ${pascalCase(name)}Callback.call(.{.instance = cb.instance}, thisValue, globalObject, args);
      }
    `;
  }

  out = out.trim();

  out += `
  extern fn ${symbolName(typeName, "_setAllCallbacks")}(JSC.JSValue, ${Object.keys(callbacks)
    .map((a, i) => `callback${i}: JSC.JSValue`)
    .join(", ")}) void;

  pub inline fn set(this: @This(), values: struct {
    ${Object.keys(callbacks)
      .map((name, i) => `${camelCase(name)}: JSC.JSValue = .zero,`)
      .join("\n")}
  }) void {
    ${symbolName(typeName, "_setAllCallbacks")}(this.instance, ${Object.keys(callbacks)
      .map((name, i) => `values.${camelCase(name)}`)
      .join(", ")},);
  }
  `;

  out += "\n};\n";

  out += `
  
  pub fn callbacks(_: *const ${typeName}, instance: JSC.JSValue) Callbacks {
    return .{.instance = instance };
  }
  
`;

  return "\n" + out;
}

function renderDecls(symbolName, typeName, proto, supportsObjectCreate = false) {
  const rows = [];

  for (const name in proto) {
    if ("getter" in proto[name] || ("accessor" in proto[name] && proto[name].getter)) {
      rows.push(
        `extern "C" JSC::EncodedJSValue ${symbolName(
          typeName,
          proto[name].getter || proto[name].accessor.getter,
        )}(void* ptr,${
          !!proto[name].this ? " JSC::EncodedJSValue thisValue, " : ""
        } JSC::JSGlobalObject* lexicalGlobalObject);`,
        `
    JSC_DECLARE_CUSTOM_GETTER(${symbolName(typeName, name)}GetterWrap);
    `.trim(),
        "\n",
      );

      if (supportsObjectCreate && !("setter" in proto[name])) {
        rows.push("\n" + `static JSC_DECLARE_CUSTOM_SETTER(${symbolName(typeName, name)}SetterWrap);` + "\n");
      }
    }

    if ("setter" in proto[name] || ("accessor" in proto[name] && proto[name].setter)) {
      rows.push(
        `extern "C" bool ${symbolName(typeName, proto[name].setter || proto[name].accessor.setter)}(void* ptr,${
          !!proto[name].this ? " JSC::EncodedJSValue thisValue, " : ""
        } JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue value);`,
        `
      static JSC_DECLARE_CUSTOM_SETTER(${symbolName(typeName, name)}SetterWrap);
      `.trim(),
        "\n",
      );
    }

    if ("fn" in proto[name]) {
      rows.push(
        `extern "C" EncodedJSValue ${symbolName(
          typeName,
          proto[name].fn,
        )}(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);`,

        `
        JSC_DECLARE_HOST_FUNCTION(${symbolName(typeName, name)}Callback);
        `.trim(),
        "\n",
      );

      if (proto[name].DOMJIT) {
        rows.push(
          DOMJITFunctionDeclaration(
            className(typeName),
            symbolName(typeName, name),
            symbolName(typeName, proto[name].fn),
            proto[name].DOMJIT,
          ),
          DOMJITFunctionDefinition(
            className(typeName),
            symbolName(typeName, name),
            symbolName(typeName, proto[name].fn),
            proto[name].DOMJIT,
          ),
        );
      }
    }
  }

  return rows.join("\n");
}

function renderStaticDecls(symbolName, typeName, fields, supportsObjectCreate = false) {
  const rows = [];

  for (const name in fields) {
    if ("getter" in fields[name] || ("accessor" in fields[name] && fields[name].getter)) {
      rows.push(
        `extern "C" JSC_DECLARE_CUSTOM_GETTER(${symbolName(
          typeName,
          fields[name].getter || fields[name].accessor.getter,
        )});`,
      );
    }

    if ("setter" in fields[name] || ("accessor" in fields[name] && fields[name].setter)) {
      rows.push(
        `extern "C" JSC_DECLARE_CUSTOM_SETTER(${symbolName(
          typeName,
          fields[name].setter || fields[name].accessor.setter,
        )});`,
      );
    }

    if ("fn" in fields[name]) {
      rows.push(`extern "C" JSC_DECLARE_HOST_FUNCTION(${symbolName(typeName, fields[name].fn)});`);
    }
  }

  return rows.join("\n");
}
function writeBarrier(symbolName, typeName, name, cacheName) {
  return `

  extern "C" void ${symbolName(typeName, name)}SetCachedValue(JSC::EncodedJSValue thisValue, JSC::JSGlobalObject *globalObject, JSC::EncodedJSValue value)
  {
      auto& vm = globalObject->vm();
      auto* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(thisValue));
      thisObject->${cacheName}.set(vm, thisObject, JSValue::decode(value));
  }

  extern "C" EncodedJSValue ${symbolName(typeName, name)}GetCachedValue(JSC::EncodedJSValue thisValue)
  {
    auto* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(thisValue));
    return JSValue::encode(thisObject->${cacheName}.get());
  }

  `;
}
function renderFieldsImpl(
  symbolName: (typeName: string, name: string) => string,
  typeName: string,
  obj: ClassDefinition,
  proto: ClassDefinition["proto"],
  cachedValues: string[],
) {
  const rows: string[] = [];

  const supportsObjectCreate = obj.supportsObjectCreate || false;

  if (obj.construct) {
    rows.push(`

JSC_DEFINE_CUSTOM_GETTER(js${typeName}Constructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* prototype = jsDynamicCast<${prototypeName(typeName)}*>(JSValue::decode(thisValue));

    if (UNLIKELY(!prototype))
        return throwVMTypeError(lexicalGlobalObject, throwScope, "Cannot get constructor for ${typeName}"_s);
    return JSValue::encode(globalObject->${className(typeName)}Constructor());
}

`);
  }

  for (const name in proto) {
    if ("cache" in proto[name] || proto[name]?.internal) {
      const cacheName = typeof proto[name].cache === "string" ? `m_${proto[name].cache}` : `m_${name}`;
      if ("cache" in proto[name]) {
        if (!supportsObjectCreate) {
          rows.push(`
JSC_DEFINE_CUSTOM_GETTER(${symbolName(typeName, name)}GetterWrap, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue encodedThisValue, PropertyName attributeName))
{
    auto& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    ${className(typeName)}* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
      JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);

    if (JSValue cachedValue = thisObject->${cacheName}.get())
        return JSValue::encode(cachedValue);

    JSC::JSValue result = JSC::JSValue::decode(
        ${symbolName(typeName, proto[name].getter)}(thisObject->wrapped(),${
          proto[name].this!! ? " encodedThisValue, " : ""
        } globalObject)
    );
    RETURN_IF_EXCEPTION(throwScope, {});
    thisObject->${cacheName}.set(vm, thisObject, result);
    RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
}`);
        } else {
          rows.push(`
          JSC_DEFINE_CUSTOM_GETTER(${symbolName(typeName, name)}GetterWrap, (JSGlobalObject * globalObject, EncodedJSValue encodedThisValue, PropertyName attributeName))
          {
              auto& vm = globalObject->vm();
              auto throwScope = DECLARE_THROW_SCOPE(vm);
              ${className(typeName)}* thisObject = jsDynamicCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
              if (UNLIKELY(!thisObject)) {
                  return JSValue::encode(jsUndefined());
              }

              JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);
              
              if (JSValue cachedValue = thisObject->${cacheName}.get())
                  return JSValue::encode(cachedValue);
              
              JSC::JSValue result = JSC::JSValue::decode(
                  ${symbolName(typeName, proto[name].getter)}(thisObject->wrapped(),${
                    proto[name].this!! ? " thisValue, " : ""
                  } globalObject)
              );
              RETURN_IF_EXCEPTION(throwScope, {});
              thisObject->${cacheName}.set(vm, thisObject, result);
              RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
          }`);
        }
      }
      rows.push(writeBarrier(symbolName, typeName, name, cacheName));
    } else if ("getter" in proto[name] || ("accessor" in proto[name] && proto[name].getter)) {
      if (!supportsObjectCreate) {
        rows.push(`
JSC_DEFINE_CUSTOM_GETTER(${symbolName(typeName, name)}GetterWrap, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue encodedThisValue, PropertyName attributeName))
{
    auto& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    ${className(typeName)}* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
    JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);
    JSC::EncodedJSValue result = ${symbolName(typeName, proto[name].getter)}(thisObject->wrapped(),${
      !!proto[name].this ? " encodedThisValue, " : ""
    } globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    RELEASE_AND_RETURN(throwScope, result);
}
        `);
      } else {
        rows.push(`
      JSC_DEFINE_CUSTOM_GETTER(${symbolName(typeName, name)}GetterWrap, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue encodedThisValue, PropertyName attributeName))
      {
          auto& vm = lexicalGlobalObject->vm();
          Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
          auto throwScope = DECLARE_THROW_SCOPE(vm);
          ${className(typeName)}* thisObject = jsDynamicCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
          if (UNLIKELY(!thisObject)) {
              return JSValue::encode(jsUndefined());
          }
          JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);
          JSC::EncodedJSValue result = ${symbolName(typeName, proto[name].getter)}(thisObject->wrapped(),${
            !!proto[name].this ? " encodedThisValue, " : ""
          } globalObject);
          RETURN_IF_EXCEPTION(throwScope, {});
          RELEASE_AND_RETURN(throwScope, result);
      }
              `);
      }
    }

    if ("setter" in proto[name] || ("accessor" in proto[name] && proto[name].setter)) {
      rows.push(
        `
JSC_DEFINE_CUSTOM_SETTER(${symbolName(typeName, name)}SetterWrap, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue encodedThisValue, EncodedJSValue encodedValue, PropertyName attributeName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    ${className(typeName)}* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
    JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);
    auto result = ${symbolName(typeName, proto[name].setter || proto[name].accessor.setter)}(thisObject->wrapped(),${
      !!proto[name].this ? " encodedThisValue, " : ""
    } lexicalGlobalObject, encodedValue);

    RELEASE_AND_RETURN(throwScope, result);
}
`,
      );
    } else if (supportsObjectCreate) {
      rows.push(
        `
  JSC_DEFINE_CUSTOM_SETTER(${symbolName(typeName, name)}SetterWrap, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue encodedThisValue, EncodedJSValue encodedValue, PropertyName attributeName))
  {
      auto& vm = lexicalGlobalObject->vm();
      auto throwScope = DECLARE_THROW_SCOPE(vm);
      JSValue thisValue = JSValue::decode(encodedThisValue);
      if (!thisValue.isObject()) {
        return false;
      }

      JSObject *thisObject = asObject(thisValue);
      thisObject->putDirect(vm, attributeName, JSValue::decode(encodedValue), 0);
      return true;
  }
  `,
      );
    }

    if ("fn" in proto[name]) {
      rows.push(`
    JSC_DEFINE_HOST_FUNCTION(${symbolName(typeName, name)}Callback, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
    {
        auto& vm = lexicalGlobalObject->vm();

        ${className(typeName)}* thisObject = jsDynamicCast<${className(typeName)}*>(callFrame->thisValue());

        if (UNLIKELY(!thisObject)) {
            auto throwScope = DECLARE_THROW_SCOPE(vm);
            throwVMTypeError(lexicalGlobalObject, throwScope, "Expected 'this' to be instanceof ${typeName}"_s);
            return JSValue::encode({});
        }

        JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);

        #ifdef BUN_DEBUG
          /** View the file name of the JS file that called this function
           * from a debugger */
          SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
          const char* fileName = sourceOrigin.string().utf8().data();
          static const char* lastFileName = nullptr;
          if (lastFileName != fileName) {
            lastFileName = fileName;
          }
        #endif

        return ${symbolName(typeName, proto[name].fn)}(thisObject->wrapped(), lexicalGlobalObject, callFrame);
    }
    `);
    }
  }

  if (cachedValues?.length) {
    for (const cacheName of cachedValues) {
      rows.push(writeBarrier(symbolName, typeName, cacheName, "m_" + cacheName));
    }
  }

  return rows.join("\n");
}

var extraIncludes = [];
function generateClassHeader(typeName, obj: ClassDefinition) {
  var { klass, proto, JSType = "ObjectType", values = [], callbacks = {}, zigOnly = false } = obj;

  if (zigOnly) return "";

  const name = className(typeName);

  const DECLARE_VISIT_CHILDREN =
    values.length ||
    obj.estimatedSize ||
    Object.keys(callbacks).length ||
    obj.hasPendingActivity ||
    [...Object.values(klass), ...Object.values(proto)].find(a => !!a.cache)
      ? "DECLARE_VISIT_CHILDREN;\ntemplate<typename Visitor> void visitAdditionalChildren(Visitor&);\nDECLARE_VISIT_OUTPUT_CONSTRAINTS;\n"
      : "";
  const sizeEstimator = obj.estimatedSize ? "static size_t estimatedSize(JSCell* cell, VM& vm);" : "";

  var weakOwner = "";
  var weakInit = ``;
  if (obj.hasPendingActivity) {
    weakInit = `m_weakThis = JSC::Weak<${name}>(this, getOwner());`;
    weakOwner = `
    JSC::Weak<${name}> m_weakThis;


    static bool hasPendingActivity(void* ctx);

    class Owner final : public JSC::WeakHandleOwner {
      public:
          bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void* context, JSC::AbstractSlotVisitor& visitor, const char** reason) final
          {
              auto* controller = JSC::jsCast<${name}*>(handle.slot()->asCell());
              if (${name}::hasPendingActivity(controller->wrapped())) {
                  if (UNLIKELY(reason))
                    *reason = "has pending activity";
                  return true;
              }

              return visitor.containsOpaqueRoot(context);
          }
          void finalize(JSC::Handle<JSC::Unknown>, void* context) final {}
      };

      static JSC::WeakHandleOwner* getOwner()
      {
          static NeverDestroyed<Owner> m_owner;
          return &m_owner.get();
      }
      `;
  }
  var suffix = "";

  if (obj.getInternalProperties) {
    suffix += `JSC::JSValue getInternalProperties(JSC::VM &vm, JSC::JSGlobalObject *globalObject, ${name}*);`;
  }

  return `
  class ${name} final : public JSC::JSDestructibleObject {
    public:
        using Base = JSC::JSDestructibleObject;
        static ${name}* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* ctx);

        DECLARE_EXPORT_INFO;
        template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
        {
            if constexpr (mode == JSC::SubspaceAccess::Concurrently)
                return nullptr;
            return WebCore::subspaceForImpl<${name}, WebCore::UseCustomHeapCellType::No>(
                vm,
                [](auto& spaces) { return spaces.${clientSubspaceFor(typeName)}.get(); },
                [](auto& spaces, auto&& space) { spaces.${clientSubspaceFor(typeName)} = std::forward<decltype(space)>(space); },
                [](auto& spaces) { return spaces.${subspaceFor(typeName)}.get(); },
                [](auto& spaces, auto&& space) { spaces.${subspaceFor(typeName)} = std::forward<decltype(space)>(space); });
        }

        static void destroy(JSC::JSCell*);
        static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
        {
            return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(${JSType}), StructureFlags), info());
        }

        static JSObject* createPrototype(VM& vm, JSDOMGlobalObject* globalObject);
        ${
          obj.noConstructor
            ? ""
            : `static JSObject* createConstructor(VM& vm, JSGlobalObject* globalObject, JSValue prototype)`
        };

        ~${name}();

        void* wrapped() const { return m_ctx; }

        void detach()
        {
            m_ctx = nullptr;
        }

        static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);
        static ptrdiff_t offsetOfWrapped() { return OBJECT_OFFSETOF(${name}, m_ctx); }

        void* m_ctx { nullptr };


        ${name}(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr)
            : Base(vm, structure)
        {
            m_ctx = sinkPtr;
            ${weakInit.trim()}
        }

        void finishCreation(JSC::VM&);

        ${Object.entries(obj.custom ?? {})
          .map(([fieldName, field]) => {
            if (field.extraHeaderIncludes?.length ?? 0) {
              extraIncludes.push(...field.extraHeaderIncludes);
            }

            var str = "";
            if (field.header) {
              str += `#include "${field.header}";` + "\n";
            }
            str += `${field.type} ${fieldName};`;
            return str;
          })
          .join("\n")}

        ${weakOwner}

        ${DECLARE_VISIT_CHILDREN}

        ${renderCachedFieldsHeader(typeName, klass, proto, values)}
        ${callbacks ? renderCallbacksHeader(typeName, obj.callbacks) : ""}
    };
    ${suffix}
  `;
}

function generateClassImpl(typeName, obj: ClassDefinition) {
  const {
    klass: fields,
    finalize,
    proto,
    construct,
    estimatedSize,
    hasPendingActivity = false,
    getInternalProperties = false,
    callbacks = {},
  } = obj;
  const name = className(typeName);

  let DEFINE_VISIT_CHILDREN_LIST = [...Object.entries(fields), ...Object.entries(proto)]
    .filter(([name, { cache = false, internal = false }]) => (cache || internal) === true)
    .map(([name]) => `visitor.append(thisObject->m_${name});`)
    .join("\n");

  for (const name in callbacks) {
    DEFINE_VISIT_CHILDREN_LIST += "\n" + `    visitor.append(thisObject->m_callback_${name});`;
  }

  const values = (obj.values || [])
    .map(val => {
      return `visitor.append(thisObject->m_${val});`;
    })
    .join("\n");
  var DEFINE_VISIT_CHILDREN = "";
  if (DEFINE_VISIT_CHILDREN_LIST.length || estimatedSize || values.length || hasPendingActivity) {
    DEFINE_VISIT_CHILDREN = `
template<typename Visitor>
void ${name}::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ${name}* thisObject = jsCast<${name}*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    ${
      estimatedSize
        ? `if (auto* ptr = thisObject->wrapped()) {
visitor.reportExtraMemoryVisited(${symbolName(obj.name, "estimatedSize")}(ptr));
}`
        : ""
    }
    thisObject->visitAdditionalChildren<Visitor>(visitor);
}

DEFINE_VISIT_CHILDREN(${name});

template<typename Visitor>
void ${name}::visitAdditionalChildren(Visitor& visitor)
{
  ${name}* thisObject = this;
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    ${values}
    ${DEFINE_VISIT_CHILDREN_LIST}
    ${hasPendingActivity ? "visitor.addOpaqueRoot(this->wrapped());" : ""}
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(${name});

template<typename Visitor>
void ${name}::visitOutputConstraintsImpl(JSCell *cell, Visitor& visitor)
{
    ${name}* thisObject = jsCast<${name}*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    thisObject->visitAdditionalChildren<Visitor>(visitor);
}

DEFINE_VISIT_OUTPUT_CONSTRAINTS(${name});

${renderCallbacksCppImpl(typeName, callbacks)}



        `.trim();
  }

  var output = ``;

  for (let { impl } of Object.values(obj.custom ?? {})) {
    if (impl) {
      output += `#include "${impl}";` + "\n";
    }
  }

  if (hasPendingActivity) {
    output += `
    extern "C" bool ${symbolName(typeName, "hasPendingActivity")}(void* ptr);
    bool ${name}::hasPendingActivity(void* ctx) {
        return ${symbolName(typeName, "hasPendingActivity")}(ctx);
    }
`;
  }

  if (getInternalProperties) {
    output += `
    extern "C" EncodedJSValue ${symbolName(typeName, "getInternalProperties")}(void* ptr, JSC::JSGlobalObject *globalObject, EncodedJSValue thisValue);

    JSC::JSValue getInternalProperties(JSC::VM &, JSC::JSGlobalObject *globalObject, ${name}* castedThis)
    {
      return JSValue::decode(${symbolName(typeName, "getInternalProperties")}(castedThis->impl(), globalObject, JSValue::encode(castedThis)));
    }

    `;
  }

  if (finalize) {
    output += `
${name}::~${name}()
{
    if (m_ctx) {
        ${classSymbolName(typeName, "finalize")}(m_ctx);
    }
}
`;
  } else {
    output += `
${name}::~${name}()
{
}
`;
  }

  output += `



void ${name}::destroy(JSCell* cell)
{
    static_cast<${name}*>(cell)->${name}::~${name}();
}

const ClassInfo ${name}::s_info = { "${typeName}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${name}) };

void ${name}::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}


${name}* ${name}::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* ctx) {
  ${name}* ptr = new (NotNull, JSC::allocateCell<${name}>(vm)) ${name}(vm, structure, ctx);
  ptr->finishCreation(vm);
  return ptr;
}

extern "C" void* ${typeName}__fromJS(JSC::EncodedJSValue value) {
  JSC::JSValue decodedValue = JSC::JSValue::decode(value);
  if (decodedValue.isEmpty() || !decodedValue.isCell())
      return nullptr;

  JSC::JSCell* cell = decodedValue.asCell();
  ${className(typeName)}* object = JSC::jsDynamicCast<${className(typeName)}*>(cell);

  if (!object)
      return nullptr;

  return object->wrapped();
}

extern "C" bool ${typeName}__dangerouslySetPtr(JSC::EncodedJSValue value, void* ptr) {
  ${className(typeName)}* object = JSC::jsDynamicCast<${className(typeName)}*>(JSValue::decode(value));
  if (!object)
      return false;

  object->m_ctx = ptr;
  return true;
}


extern "C" const size_t ${typeName}__ptrOffset = ${className(typeName)}::offsetOfWrapped();

void ${name}::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<${name}*>(cell);
    if (void* wrapped = thisObject->wrapped()) {
        // if (thisObject->scriptExecutionContext())
        //     analyzer.setLabelForCell(cell, "url " + thisObject->scriptExecutionContext()->url().string());
    }
    Base::analyzeHeap(cell, analyzer);
}

${
  !obj.noConstructor
    ? `JSObject* ${name}::createConstructor(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
  return WebCore::${constructorName(typeName)}::create(vm, globalObject, WebCore::${constructorName(
    typeName,
  )}::createStructure(vm, globalObject, globalObject->functionPrototype()), jsCast<WebCore::${prototypeName(typeName)}*>(prototype));
}`
    : ""
}

JSObject* ${name}::createPrototype(VM& vm, JSDOMGlobalObject* globalObject)
{
    auto *structure = ${prototypeName(typeName)}::createStructure(vm, globalObject, globalObject->objectPrototype());
    structure->setMayBePrototype(true);
    return ${prototypeName(typeName)}::create(vm, globalObject, structure);
}

extern "C" EncodedJSValue ${typeName}__create(Zig::GlobalObject* globalObject, void* ptr) {
  auto &vm = globalObject->vm();
  JSC::Structure* structure = globalObject->${className(typeName)}Structure();
  ${className(typeName)}* instance = ${className(typeName)}::create(vm, globalObject, structure, ptr);
  ${
    obj.estimatedSize
      ? `vm.heap.reportExtraMemoryAllocated(instance, ${symbolName(obj.name, "estimatedSize")}(ptr));`
      : ""
  }
  return JSValue::encode(instance);
}

${DEFINE_VISIT_CHILDREN}



    `.trim();

  return output;
}

function generateHeader(typeName, obj) {
  return generateClassHeader(typeName, obj).trim() + "\n\n";
}

function generateImpl(typeName, obj) {
  if (obj.zigOnly) return "";

  const proto = obj.proto;
  return [
    generatePrototypeHeader(typeName),
    !obj.noConstructor ? generateConstructorHeader(typeName).trim() + "\n" : null,
    generatePrototype(typeName, obj).trim(),
    !obj.noConstructor ? generateConstructorImpl(typeName, obj).trim() : null,
    generateClassImpl(typeName, obj).trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function generateZig(
  typeName,
  {
    klass = {},
    proto = {},
    construct,
    finalize,
    noConstructor = false,
    estimatedSize,
    call = false,
    values = [],
    hasPendingActivity = false,
    structuredClone = false,
    getInternalProperties = false,
    callbacks = {},
  } = {} as ClassDefinition,
) {
  const exports = new Map<string, string>();

  if (construct && !noConstructor) {
    exports.set(`constructor`, classSymbolName(typeName, "construct"));
  }

  if (call) {
    exports.set(`call`, classSymbolName(typeName, "call"));
  }

  if (finalize) {
    exports.set(`finalize`, classSymbolName(typeName, "finalize"));
  }

  if (estimatedSize) {
    exports.set(`estimatedSize`, symbolName(typeName, "estimatedSize"));
  }

  if (hasPendingActivity) {
    exports.set("hasPendingActivity", symbolName(typeName, "hasPendingActivity"));
  }
  Object.values(klass).map(a => appendSymbols(exports, name => classSymbolName(typeName, name), a));
  Object.values(proto).map(a => appendSymbols(exports, name => protoSymbolName(typeName, name), a));

  if (getInternalProperties) {
    exports.set("getInternalProperties", symbolName(typeName, "getInternalProperties"));
  }

  if (structuredClone) {
    exports.set("onStructuredCloneSerialize", symbolName(typeName, "onStructuredCloneSerialize"));

    if (structuredClone === "transferable") {
      exports.set("onStructuredCloneTransfer", symbolName(typeName, "onStructuredCloneTransfer"));
    }

    exports.set("onStructuredCloneDeserialize", symbolName(typeName, "onStructuredCloneDeserialize"));
  }

  const externs = Object.entries({
    ...proto,
    ...Object.fromEntries((values || []).map(a => [a, { internal: true }])),
  })
    .filter(([name, { cache, internal }]) => (cache && typeof cache !== "string") || internal)
    .map(
      ([name]) =>
        `extern fn ${protoSymbolName(typeName, name)}SetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) void;

        extern fn ${protoSymbolName(typeName, name)}GetCachedValue(JSC.JSValue) JSC.JSValue;

        /// \`${typeName}.${name}\` setter
        /// This value will be visited by the garbage collector.
        pub fn ${name}SetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
          JSC.markBinding(@src());
          ${protoSymbolName(typeName, name)}SetCachedValue(thisValue, globalObject, value);
        }

        /// \`${typeName}.${name}\` getter
        /// This value will be visited by the garbage collector.
        pub fn ${name}GetCached(thisValue: JSC.JSValue) ?JSC.JSValue {
          JSC.markBinding(@src());
          const result = ${protoSymbolName(typeName, name)}GetCachedValue(thisValue);
          if (result == .zero)
            return null;

          return result;
        }
`.trim() + "\n",
    )
    .join("\n");

  var renderedCallbacks = "";
  if (Object.keys(callbacks).length) {
    renderedCallbacks = renderCallbacksZig(typeName, callbacks);
  }

  function typeCheck() {
    var output = "";

    if (estimatedSize) {
      output += `
        if (@TypeOf(${typeName}.estimatedSize) != (fn(*${typeName}) callconv(.C) usize)) {
           @compileLog("${typeName}.estimatedSize is not a size function");
        }
      `;
    }

    if (structuredClone) {
      output += `
      if (@TypeOf(${typeName}.onStructuredCloneSerialize) != (fn(*${typeName}, globalThis: *JSC.JSGlobalObject, ctx: *anyopaque, writeBytes: *const fn(*anyopaque, ptr: [*]const u8, len: u32) callconv(.C) void) callconv(.C) void)) {
        @compileLog("${typeName}.onStructuredCloneSerialize is not a structured clone serialize function");
      }
      `;

      if (getInternalProperties) {
        output += `
        if (@TypeOf(${typeName}.getInternalProperties) != (fn(*${typeName}, globalThis: *JSC.JSGlobalObject, JSC.JSValue thisValue) callconv(.C) JSC.JSValue {
          @compileLog("${typeName}.getInternalProperties is not a getInternalProperties function");
        }
        `;
      }

      if (structuredClone === "transferable") {
        exports.set("structuredClone", symbolName(typeName, "onTransferableStructuredClone"));
        output += `
        if (@TypeOf(${typeName}.onStructuredCloneTransfer) != (fn(*${typeName}, globalThis: *JSC.JSGlobalObject, ctx: *anyopaque, write: *const fn(*anyopaque, ptr: [*]const u8, len: usize) callconv(.C) void) callconv(.C) void)) {
          @compileLog("${typeName}.onStructuredCloneTransfer is not a structured clone transfer function");
        }
        `;
      }

      output += `
      if (@TypeOf(${typeName}.onStructuredCloneDeserialize) != (fn(globalThis: *JSC.JSGlobalObject, ptr: [*]u8, end: [*]u8) callconv(.C) JSC.JSValue)) {
        @compileLog("${typeName}.onStructuredCloneDeserialize is not a structured clone deserialize function");
      }
      `;
    }

    if (construct && !noConstructor) {
      output += `
        if (@TypeOf(${typeName}.constructor) != (fn(*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*${typeName})) {
           @compileLog("${typeName}.constructor is not a constructor");
        }
      `;
    }

    if (finalize) {
      output += `
        if (@TypeOf(${typeName}.finalize) != (fn(*${typeName}) callconv(.C) void)) {
           @compileLog("${typeName}.finalize is not a finalizer");
        }
      `;
    }

    [...Object.values(proto)].forEach(({ getter, setter, accessor, fn, this: thisValue = false, cache, DOMJIT }) => {
      if (accessor) {
        getter = accessor.getter;
        setter = accessor.setter;
      }

      if (getter) {
        if (thisValue) {
          output += `
            if (@TypeOf(${typeName}.${getter}) != GetterTypeWithThisValue)
              @compileLog("Expected ${typeName}.${getter} to be a getter with thisValue");`;
        } else {
          output += `
            if (@TypeOf(${typeName}.${getter}) != GetterType)
              @compileLog(
                "Expected ${typeName}.${getter} to be a getter"
                );
`;
        }
      }

      if (setter) {
        if (thisValue) {
          output += `
            if (@TypeOf(${typeName}.${setter}) != SetterTypeWithThisValue)
              @compileLog("Expected ${typeName}.${setter} to be a setter with thisValue");`;
        } else {
          output += `
            if (@TypeOf(${typeName}.${setter}) != SetterType)
              @compileLog(
                "Expected ${typeName}.${setter} to be a setter"
              );`;
        }
      }

      if (fn) {
        if (DOMJIT) {
          output += `
          if (@TypeOf(${typeName}.${DOMJITName(fn)}) != ${ZigDOMJITFunctionType(typeName, DOMJIT)})
            @compileLog(
              "Expected ${typeName}.${DOMJITName(fn)} to be a DOMJIT function"
            );`;
        }

        output += `
          if (@TypeOf(${typeName}.${fn}) != CallbackType)
            @compileLog(
              "Expected ${typeName}.${fn} to be a callback but received " ++ @typeName(@TypeOf(${typeName}.${fn}))
            );`;
      }
    });

    [...Object.values(klass)].forEach(({ getter, setter, accessor, fn }) => {
      if (accessor) {
        getter = accessor.getter;
        setter = accessor.setter;
      }

      if (getter) {
        output += `
          if (@TypeOf(${typeName}.${getter}) != StaticGetterType)
            @compileLog(
              "Expected ${typeName}.${getter} to be a static getter"
            );
`;
      }

      if (setter) {
        output += `
          if (@TypeOf(${typeName}.${setter}) != StaticSetterType)
            @compileLog(
              "Expected ${typeName}.${setter} to be a static setter"
            );`;
      }

      if (fn) {
        output += `
          if (@TypeOf(${typeName}.${fn}) != StaticCallbackType)
            @compileLog(
              "Expected ${typeName}.${fn} to be a static callback"
            );`;
      }
    });

    if (!!call) {
      output += `
      if (@TypeOf(${typeName}.call) != StaticCallbackType)
      @compileLog(
        "Expected ${typeName}.call to be a static callback"
      );`;
    }

    return output;
  }

  return `

pub const ${className(typeName)} = struct {
    const ${typeName} = Classes.${typeName};
    const GetterType = fn(*${typeName}, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const GetterTypeWithThisValue = fn(*${typeName}, JSC.JSValue, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn(*${typeName}, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const SetterTypeWithThisValue = fn(*${typeName}, JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn(*${typeName}, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*${typeName} {
        JSC.markBinding(@src());
        return ${symbolName(typeName, "fromJS")}(value);
    }

    ${externs}

    ${
      !noConstructor
        ? `
    /// Get the ${typeName} constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        return ${symbolName(typeName, "getConstructor")}(globalObject);
    }
  `
        : ""
    }
    /// Create a new instance of ${typeName}
    pub fn toJS(this: *${typeName}, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding(@src());
        if (comptime Environment.allow_assert) {
            const value__ = ${symbolName(typeName, "create")}(globalObject, this);
            std.debug.assert(value__.as(${typeName}).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return ${symbolName(typeName, "create")}(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of ${typeName}.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*${typeName}) bool {
      JSC.markBinding(@src());
      return ${symbolName(typeName, "dangerouslySetPtr")}(value, ptr);
    }

    /// Detach the ptr from the thisValue
    pub fn detachPtr(_: *${typeName}, value: JSC.JSValue) void {
      JSC.markBinding(@src());
      std.debug.assert(${symbolName(typeName, "dangerouslySetPtr")}(value, null));
    }

    extern fn ${symbolName(typeName, "fromJS")}(JSC.JSValue) ?*${typeName};
    extern fn ${symbolName(typeName, "getConstructor")}(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn ${symbolName(typeName, "create")}(globalObject: *JSC.JSGlobalObject, ptr: ?*${typeName}) JSC.JSValue;

    extern fn ${typeName}__dangerouslySetPtr(JSC.JSValue, ?*${typeName}) bool;

    ${renderedCallbacks}

    comptime {
        ${typeCheck()}
        if (!JSC.is_bindgen) {
${[...exports]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([internalName, externalName]) => `@export(${typeName}.${internalName}, .{.name = "${externalName}"});`)
  .join("\n          ")}
        }
    }
};


`;
}

function generateLazyClassStructureHeader(typeName, { klass = {}, proto = {}, zigOnly = false }) {
  if (zigOnly) return "";

  return `
  JSC::Structure* ${className(typeName)}Structure() { return m_${className(typeName)}.getInitializedOnMainThread(this); }
  JSC::JSObject* ${className(typeName)}Constructor() { return m_${className(typeName)}.constructorInitializedOnMainThread(this); }
  JSC::JSValue ${className(typeName)}Prototype() { return m_${className(typeName)}.prototypeInitializedOnMainThread(this); }
  JSC::LazyClassStructure m_${className(typeName)};
    `.trim();
}

function generateLazyClassStructureImpl(typeName, { klass = {}, proto = {}, noConstructor = false, zigOnly = false }) {
  if (zigOnly) return "";

  return `
          m_${className(typeName)}.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::${className(typeName)}::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::${className(typeName)}::createStructure(init.vm, init.global, init.prototype));
                 ${
                   noConstructor
                     ? ""
                     : `init.setConstructor(WebCore::${className(
                          typeName,
                        )}::createConstructor(init.vm, init.global, init.prototype));`
                 }
              });


      `.trim();
}

const GENERATED_CLASSES_HEADER = [
  `
// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by "bun run build"
#pragma once

#include "root.h"

namespace Zig {
}

#include "JSDOMWrapper.h"
#include <wtf/NeverDestroyed.h>
#include "SerializedScriptValue.h"
`,

  `

namespace WebCore {
using namespace Zig;
using namespace JSC;

`,
];

const GENERATED_CLASSES_IMPL_HEADER = `
// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by make codegen
#include "root.h"
#include "headers.h"

#include "BunClientData.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"
#include <JavaScriptCore/DFGAbstractHeap.h>

#include "JSDOMConvertBufferSource.h"
#include "ZigGeneratedClasses.h"




namespace WebCore {

using namespace JSC;
using namespace Zig;

`;

const GENERATED_CLASSES_IMPL_FOOTER = `

} // namespace WebCore

`;

function initLazyClasses(initLaterFunctions) {
  return `

ALWAYS_INLINE void GlobalObject::initGeneratedLazyClasses() {
    ${initLaterFunctions.map(a => a.trim()).join("\n    ")}
}

`.trim();
}

function visitLazyClasses(classes) {
  return `

template<typename Visitor>
void GlobalObject::visitGeneratedLazyClasses(GlobalObject *thisObject, Visitor& visitor)
{
      ${classes.map(a => `thisObject->m_${className(a.name)}.visit(visitor);`).join("\n      ")}
}

  `.trim();
}

const ZIG_GENERATED_CLASSES_HEADER = `
/// Generated code! To regenerate, run:
///
///    bun run build
///
/// This file is generated by:
///  1. \`bun src/bun.js/scripts/generate-classes.ts\`
///  2. Scan for **/*.classes.ts files in src/bun.js/src
///  3. Generate a JS wrapper for each class in:
///        - Zig: generated_classes.zig
///        - C++: ZigGeneratedClasses.h, ZigGeneratedClasses.cpp
///  4. For the Zig code to successfully compile:
///        - Add it to generated_classes_list.zig
///        - pub usingnamespace JSC.Codegen.JSMyClassName;
///  5. bun run build
///
const bun = @import("root").bun;
const JSC = bun.JSC;
const Classes = JSC.GeneratedClassesList;
const Environment = bun.Environment;
const std = @import("std");

pub const StaticGetterType = fn(*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue) callconv(.C) JSC.JSValue;
pub const StaticSetterType = fn(*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue, JSC.JSValue) callconv(.C) bool;
pub const StaticCallbackType = fn(*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

`;

const classes = [];
for (const file of files) {
  const result = require(path.resolve(file));
  if (!(result?.default?.length ?? 0)) continue;
  console.log("Found", result.default.length, "classes from", file);
  for (let { name, proto = {}, klass = {} } of result.default) {
    let protoProps = Object.keys(proto).length ? `${Object.keys(proto).length} fields` : "";
    let klassProps = Object.keys(klass).length ? `${Object.keys(klass).length} class fields` : "";
    let props = [protoProps, klassProps].filter(Boolean).join(", ");
    if (props.length) props = ` (${props})`;
    console.log(`  - ${name}` + props);
  }

  classes.push(...result.default);
}
classes.sort((a, b) => (a.name < b.name ? -1 : 1));

// sort all the prototype keys and klass keys
for (const obj of classes) {
  let { klass = {}, proto = {} } = obj;

  klass = Object.fromEntries(Object.entries(klass).sort(([a], [b]) => a.localeCompare(b)));
  proto = Object.fromEntries(Object.entries(proto).sort(([a], [b]) => a.localeCompare(b)));
  obj.klass = klass;
  obj.proto = proto;
}

const GENERATED_CLASSES_FOOTER = `

class StructuredCloneableSerialize {
  public:

    void (*cppWriteBytes)(CloneSerializer*, const uint8_t*, uint32_t);

    std::function<void(void*, JSC::JSGlobalObject*, void*, void (*)(CloneSerializer*, const uint8_t*, uint32_t))> zigFunction;

    uint8_t tag;

    // the type from zig
    void* impl;

    static std::optional<StructuredCloneableSerialize> fromJS(JSC::JSValue);
    void write(CloneSerializer* serializer, JSC::JSGlobalObject* globalObject)
    {
      zigFunction(impl, globalObject, serializer, cppWriteBytes);
    }
};

class StructuredCloneableDeserialize {
  public:
    static std::optional<JSC::EncodedJSValue> fromTagDeserialize(uint8_t tag, JSC::JSGlobalObject*, const uint8_t*, const uint8_t*);
};

}

`;

function writeCppSerializers() {
  var output = ``;

  var structuredClonable = classes
    .filter(a => a.structuredClone)
    .sort((a, b) => a.structuredClone.tag < b.structuredClone.tag);

  function fromJSForEachClass(klass) {
    return `
    if (auto* result = jsDynamicCast<${className(klass.name)}*>(value)) {
      return StructuredCloneableSerialize { .cppWriteBytes = SerializedScriptValue::writeBytesForBun, .zigFunction = ${symbolName(
        klass.name,
        "onStructuredCloneSerialize",
      )}, .tag = ${klass.structuredClone.tag}, .impl = result->wrapped() };
    }
    `;
  }

  function fromTagDeserializeForEachClass(klass) {
    return `
    if (tag == ${klass.structuredClone.tag}) {
      return ${symbolName(klass.name, "onStructuredCloneDeserialize")}(globalObject, ptr, end);
    }
    `;
  }

  output += `
  std::optional<StructuredCloneableSerialize> StructuredCloneableSerialize::fromJS(JSC::JSValue value)
  {
    ${structuredClonable.map(fromJSForEachClass).join("\n").trim()}
    return std::nullopt;
  }
  `;

  output += `
  std::optional<JSC::EncodedJSValue> StructuredCloneableDeserialize::fromTagDeserialize(uint8_t tag, JSC::JSGlobalObject* globalObject, const uint8_t* ptr, const uint8_t* end)
  {
    ${structuredClonable.map(fromTagDeserializeForEachClass).join("\n").trim()}
    return std::nullopt;
  }
  `;

  return output;
}

await writeIfNotChanged(`${outBase}/ZigGeneratedClasses.zig`, [
  ZIG_GENERATED_CLASSES_HEADER,

  ...classes.map(a => generateZig(a.name, a).trim()).join("\n"),
  "\n",
  `
comptime {
  ${classes.map(a => `_ = ${className(a.name)};`).join("\n  ")}
}

  `,
]);
if (!process.env.ONLY_ZIG) {
  const allHeaders = classes.map(a => generateHeader(a.name, a));
  await writeIfNotChanged(`${outBase}/ZigGeneratedClasses.h`, [
    GENERATED_CLASSES_HEADER[0],
    ...[...new Set(extraIncludes.map(a => `#include "${a}";` + "\n"))],
    GENERATED_CLASSES_HEADER[1],
    ...allHeaders,
    GENERATED_CLASSES_FOOTER,
  ]);
  await writeIfNotChanged(`${outBase}/ZigGeneratedClasses.cpp`, [
    GENERATED_CLASSES_IMPL_HEADER,
    ...classes.map(a => generateImpl(a.name, a)),
    writeCppSerializers(classes),
    GENERATED_CLASSES_IMPL_FOOTER,
  ]);
  await writeIfNotChanged(
    `${outBase}/ZigGeneratedClasses+lazyStructureHeader.h`,
    classes.map(a => generateLazyClassStructureHeader(a.name, a)).join("\n"),
  );

  await writeIfNotChanged(
    `${outBase}/ZigGeneratedClasses+DOMClientIsoSubspaces.h`,
    classes.map(a => [`std::unique_ptr<GCClient::IsoSubspace> ${clientSubspaceFor(a.name)};`].join("\n")),
  );

  await writeIfNotChanged(
    `${outBase}/ZigGeneratedClasses+DOMIsoSubspaces.h`,
    classes.map(a => [`std::unique_ptr<IsoSubspace> ${subspaceFor(a.name)};`].join("\n")),
  );

  await writeIfNotChanged(
    `${outBase}/ZigGeneratedClasses+lazyStructureImpl.h`,
    initLazyClasses(classes.map(a => generateLazyClassStructureImpl(a.name, a))) + "\n" + visitLazyClasses(classes),
  );
}
