// @ts-nocheck
import path from "path";
import type { ClassDefinition, Field } from "./class-definitions";
import { camelCase, pascalCase, writeIfNotChanged } from "./helpers";

if (process.env.BUN_SILENT === "1") {
  console.log = () => {};
}

const files = process.argv.slice(2);
const outBase = files.pop();
let externs = "";
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

function ZigDOMJITArgTypeDefinition(type, index) {
  return `arg${index}: ${ZigDOMJITArgType(type)}`;
}

function ZigDOMJITFunctionType(thisName, { args, returns }) {
  return `fn (*${thisName}, *JSC.JSGlobalObject, ${args
    .map(ZigDOMJITArgType)
    .join(", ")}) callconv(JSC.conv) ${ZigDOMJITArgType("JSValue")}`;
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
  externs += `
extern JSC_CALLCONV JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${DOMJITName(symName)}(void* ptr, JSC::JSGlobalObject * lexicalGlobalObject${formattedArgs});
  `;

  return (
    `
extern JSC_CALLCONV JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(${DOMJITName(
      fnName,
    )}Wrapper, JSC::EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue${formattedArgs}));
static const JSC::DOMJIT::Signature DOMJITSignatureFor${fnName}(${DOMJITName(fnName)}Wrapper,
  ${jsClassName}::info(),
  ${
    pure
      ? "JSC::DOMJIT::Effect::forPure()"
      : "JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top())"
  },
  ${returns === "JSString" ? "JSC::SpecString" : DOMJITType("JSValue")}${domJITArgs});
`.trim() + "\n"
  );
}

function DOMJITFunctionDefinition(jsClassName, fnName, symName, { args }, fn) {
  const argNames = args.map((arg, i) => `${argTypeName(arg)} arg${i}`);
  const formattedArgs = argNames.length > 0 ? `, ${argNames.join(", ")}` : "";
  const retArgs = argNames.length > 0 ? `, ${args.map((b, i) => "arg" + i).join(", ")}` : "";

  return `
JSC_DEFINE_JIT_OPERATION(${DOMJITName(
    fnName,
  )}Wrapper, JSC::EncodedJSValue, (JSC::JSGlobalObject * lexicalGlobalObject, void* thisValue${formattedArgs}))
{
    VM& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
#if BUN_DEBUG
    ${jsClassName}* wrapper = reinterpret_cast<${jsClassName}*>(thisValue);
    JSC::EncodedJSValue result = ${DOMJITName(symName)}(wrapper->wrapped(), lexicalGlobalObject${retArgs});
    JSValue decoded = JSValue::decode(result);
    if (wrapper->m_${fn}_expectedResultType) {
        if (decoded.isCell() && !decoded.isEmpty()) {
          ASSERT_WITH_MESSAGE(wrapper->m_${fn}_expectedResultType.value().has_value(), "DOMJIT function return type changed!");
          ASSERT_WITH_MESSAGE(wrapper->m_${fn}_expectedResultType.value().value() == decoded.asCell()->type(), "DOMJIT function return type changed!");
        } else {
          ASSERT_WITH_MESSAGE(!wrapper->m_${fn}_expectedResultType.value().has_value(), "DOMJIT function return type changed!");
        }
    } else if (!decoded.isEmpty()) {
        wrapper->m_${fn}_expectedResultType = decoded.isCell()
          ? std::optional<JSC::JSType>(decoded.asCell()->type())
          : std::optional<JSC::JSType>(std::nullopt);
    }
    return { result };
#endif
    return {${DOMJITName(symName)}(reinterpret_cast<${jsClassName}*>(thisValue)->wrapped(), lexicalGlobalObject${retArgs})};
}
`.trim();
}

function zigExportName(to: Map<string, string>, symbolName: (name: string) => string, prop) {
  var { defaultValue, getter, setter, accessor, fn, DOMJIT, cache } = prop;
  const exportNames = {
    getter: "",
    setter: "",
    fn: "",
    DOMJIT: "",
  };

  if (accessor) {
    getter = accessor.getter;
    setter = accessor.setter;
  }

  if (getter && !to.get(getter)) {
    to.set(getter, (exportNames.getter = symbolName(getter)));
  }

  if (setter && !to.get(setter)) {
    to.set(setter, (exportNames.setter = symbolName(setter)));
  }

  if (fn && !to.get(fn)) {
    if (DOMJIT) {
      to.set(DOMJITName(fn), (exportNames.DOMJIT = symbolName(DOMJITName(fn))));
    }
    to.set(fn, (exportNames.fn = symbolName(fn)));
  }

  return exportNames;
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
    accessor,
    fn,
    length = 0,
    cache,
    DOMJIT,
    enumerable = true,
    configurable = false,
    value,
    builtin,
    writable = false,
  } = (defaultPropertyAttributes ? Object.assign({}, defaultPropertyAttributes, prop) : prop) as any;

  var extraPropertyAttributes = "";
  if (!enumerable) {
    extraPropertyAttributes += " | PropertyAttribute::DontEnum";
  }

  if (!configurable) {
    extraPropertyAttributes += " | PropertyAttribute::DontDelete";
  }

  if (accessor) {
    getter = accessor.getter;
    setter = accessor.setter;
  }

  var symbol = symbolName(typeName, name);

  if (isWrapped) {
    if (getter) {
      getter = symbol + "GetterWrap";
    }
    if (setter || writable) {
      setter = symbol + "SetterWrap";
    }
    if (fn) {
      fn = symbol + "Callback";
    }
  } else {
    if (getter) {
      getter = symbolName(typeName, getter);
    }
    if (setter || writable) {
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
  } else if (getter && !supportsObjectCreate && !writable) {
    return `{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute${extraPropertyAttributes}), NoIntrinsic, { HashTableValue::GetterSetterType, ${getter}, 0 } }
`.trim();
  } else if (getter && !supportsObjectCreate && writable) {
    return `{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute${extraPropertyAttributes}), NoIntrinsic, { HashTableValue::GetterSetterType, ${getter}, ${setter} } }
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

  if (obj.construct) {
    externs += `
extern JSC_CALLCONV void* JSC_HOST_CALL_ATTRIBUTES ${classSymbolName(typeName, "construct")}(JSC::JSGlobalObject*, JSC::CallFrame*);
JSC_DECLARE_CUSTOM_GETTER(js${typeName}Constructor);
`;
  }

  if (obj.structuredClone) {
    externs +=
      `extern JSC_CALLCONV void JSC_HOST_CALL_ATTRIBUTES ${symbolName(
        typeName,
        "onStructuredCloneSerialize",
      )}(void*, JSC::JSGlobalObject*, WebCore::CloneSerializer*, SYSV_ABI void (*) (WebCore::CloneSerializer*, const uint8_t*, uint32_t));` +
      "\n";

    externs +=
      `extern JSC_CALLCONV JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${symbolName(
        typeName,
        "onStructuredCloneDeserialize",
      )}(JSC::JSGlobalObject*, const uint8_t*, const uint8_t*);` + "\n";
  }
  if (obj.finalize) {
    externs +=
      `extern JSC_CALLCONV void JSC_HOST_CALL_ATTRIBUTES ${classSymbolName(typeName, "finalize")}(void*);` + "\n";
  }

  if (obj.call) {
    externs += `extern JSC_CALLCONV JSC_DECLARE_HOST_FUNCTION(${classSymbolName(typeName, "call")}) SYSV_ABI;` + "\n";
  }

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

function generatePrototypeHeader(typename, final = true) {
  const proto = prototypeName(typename);

  return `
class ${proto} ${final ? "final" : ""} : public JSC::JSNonFinalObject {
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

  protected:
      ${proto}(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
          : Base(vm, structure)
      {
      }

      void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};
`;
}

function generateConstructorHeader(typeName) {
  const name = constructorName(typeName);

  // we use a single shared isosubspace for constructors since they will rarely
  // ever be created multiple times per VM and have no fields themselves
  return (
    `
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
      static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);

      DECLARE_EXPORT_INFO;
  protected:
      ${name}(JSC::VM& vm, JSC::Structure* structure);
      void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, ${prototypeName(typeName)}* prototype);
};

    `.trim() + "\n"
  );
}

function generateConstructorImpl(typeName, obj: ClassDefinition) {
  const name = constructorName(typeName);
  const { klass: fields } = obj;
  const hashTable =
    Object.keys(fields).length > 0 ? generateHashTable(name, classSymbolName, typeName, obj, fields, false) : "";

  const hashTableIdentifier = hashTable.length ? `${name}TableValues` : "";
  if (obj.estimatedSize) {
    externs += `extern JSC_CALLCONV size_t ${symbolName(typeName, "estimatedSize")}(void* ptr);` + "\n";
  }

  return `
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
    obj.call ? classSymbolName(typeName, "call") : "call"
  }, construct) {

  }

${name}* ${name}::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, ${prototypeName(
    typeName,
  )}* prototype) {
    ${name}* ptr = new (NotNull, JSC::allocateCell<${name}>(vm)) ${name}(vm, structure);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${name}::call(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::VM &vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    void* ptr = ${classSymbolName(typeName, "construct")}(globalObject, callFrame);

    if (UNLIKELY(!ptr || scope.exception())) {
      return JSValue::encode(JSC::jsUndefined());
    }

    Structure* structure = globalObject->${className(typeName)}Structure();
    ${className(typeName)}* instance = ${className(typeName)}::create(vm, globalObject, structure, ptr);
    RETURN_IF_EXCEPTION(scope, {});
  ${
    obj.estimatedSize
      ? `
      auto size = ${symbolName(typeName, "estimatedSize")}(ptr);
      vm.heap.reportExtraMemoryAllocated(instance, size);`
      : ""
  }

    RELEASE_AND_RETURN(scope, JSValue::encode(instance));
}


JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${name}::construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSC::VM &vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* newTarget = asObject(callFrame->newTarget());
    auto* constructor = globalObject->${className(typeName)}Constructor();
    Structure* structure = globalObject->${className(typeName)}Structure();
    if (UNLIKELY(constructor != newTarget)) {
      auto* functionGlobalObject = defaultGlobalObject(
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

    if (UNLIKELY(!ptr || scope.exception())) {
      return JSValue::encode(JSC::jsUndefined());
    }

    ${className(typeName)}* instance = ${className(typeName)}::create(vm, globalObject, structure, ptr);
  ${
    obj.estimatedSize
      ? `
      auto size = ${symbolName(typeName, "estimatedSize")}(ptr);
      vm.heap.reportExtraMemoryAllocated(instance, size);`
      : ""
  }

    auto value = JSValue::encode(instance);
    RELEASE_AND_RETURN(scope, value);
}

void ${name}::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, ${prototypeName(typeName)}* prototype)
{

}

const ClassInfo ${name}::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${name}) };

${
  !obj.noConstructor
    ? `
  extern JSC_CALLCONV JSC::EncodedJSValue ${typeName}__getConstructor(Zig::GlobalObject* globalObject) {
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
  extern JSC_CALLCONV JSC::EncodedJSValue ${symbolName(typeName, "_callback_get_" + name)}(JSC::EncodedJSValue encodedThisValue) {
    auto* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
    return JSValue::encode(thisObject->m_callback_${name}.get());
  }

  extern JSC_CALLCONV void ${symbolName(typeName, "_callback_set_" + name)}(JSC::EncodedJSValue encodedThisValue, JSC::EncodedJSValue encodedCallback) {
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
  extern JSC_CALLCONV void ${symbolName(typeName, "_setAllCallbacks")}(JSC::EncodedJSValue encodedThisValue, ${Object.keys(
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

  return rows.map(a => a.trim()).join("\n");
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
      extern fn ${get}(JSC.JSValue) callconv(JSC.conv) JSC.JSValue;
      extern fn ${set}(JSC.JSValue, JSC.JSValue) callconv(JSC.conv) void;
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
    .join(", ")}) callconv(JSC.conv) void;

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
      externs +=
        `extern JSC_CALLCONV JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${symbolName(
          typeName,
          proto[name].getter || proto[name].accessor.getter,
        )}(void* ptr,${
          !!proto[name].this ? " JSC::EncodedJSValue thisValue, " : ""
        } JSC::JSGlobalObject* lexicalGlobalObject);` + "\n";

      rows.push(
        `
    JSC_DECLARE_CUSTOM_GETTER(${symbolName(typeName, name)}GetterWrap);
    ${proto[name].writable ? `JSC_DECLARE_CUSTOM_SETTER(${symbolName(typeName, name)}SetterWrap);` : ""}
    `.trim(),
        "\n",
      );

      if (supportsObjectCreate && !("setter" in proto[name])) {
        rows.push("\n" + `static JSC_DECLARE_CUSTOM_SETTER(${symbolName(typeName, name)}SetterWrap);` + "\n");
      }
    }

    if ("setter" in proto[name] || ("accessor" in proto[name] && proto[name].setter)) {
      externs +=
        `extern JSC_CALLCONV bool JSC_HOST_CALL_ATTRIBUTES ${symbolName(typeName, proto[name].setter || proto[name].accessor.setter)}(void* ptr,${
          !!proto[name].this ? " JSC::EncodedJSValue thisValue, " : ""
        } JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue value);` + "\n";
      rows.push(
        `
      static JSC_DECLARE_CUSTOM_SETTER(${symbolName(typeName, name)}SetterWrap);
      `.trim(),
        "\n",
      );
    }

    if ("fn" in proto[name]) {
      externs +=
        `extern JSC_CALLCONV JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${symbolName(
          typeName,
          proto[name].fn,
        )}(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame${proto[name].passThis ? ", JSC::EncodedJSValue thisValue" : ""});` +
        "\n";
      rows.push(
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
            proto[name].fn,
          ),
        );
      }
    }
  }

  return rows.map(a => a.trim()).join("\n");
}

function renderStaticDecls(symbolName, typeName, fields, supportsObjectCreate = false) {
  const rows = [];

  for (const name in fields) {
    if ("getter" in fields[name] || ("accessor" in fields[name] && fields[name].getter)) {
      externs +=
        `extern JSC_CALLCONV JSC_DECLARE_CUSTOM_GETTER(${symbolName(
          typeName,
          fields[name].getter || fields[name].accessor.getter,
        )});` + "\n";
    }

    if ("setter" in fields[name] || ("accessor" in fields[name] && fields[name].setter)) {
      externs +=
        `extern JSC_CALLCONV JSC_DECLARE_CUSTOM_SETTER(${symbolName(
          typeName,
          fields[name].setter || fields[name].accessor.setter,
        )});` + "\n";
    }

    if ("fn" in fields[name]) {
      externs +=
        `extern JSC_CALLCONV JSC_DECLARE_HOST_FUNCTION(${symbolName(typeName, fields[name].fn)}) SYSV_ABI;` + "\n";
    }
  }

  return rows.join("\n");
}
function writeBarrier(symbolName, typeName, name, cacheName) {
  return `

extern JSC_CALLCONV void ${symbolName(typeName, name)}SetCachedValue(JSC::EncodedJSValue thisValue, JSC::JSGlobalObject *globalObject, JSC::EncodedJSValue value)
{
    auto& vm = globalObject->vm();
    auto* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(thisValue));
    thisObject->${cacheName}.set(vm, thisObject, JSValue::decode(value));
}

extern JSC_CALLCONV JSC::EncodedJSValue ${symbolName(typeName, name)}GetCachedValue(JSC::EncodedJSValue thisValue)
{
  auto* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(thisValue));
  return JSValue::encode(thisObject->${cacheName}.get());
}

  `.trim();
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
    rows.push(
      `

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

`.trim(),
    );
  }

  for (const name in proto) {
    if ("cache" in proto[name] || proto[name]?.internal) {
      const cacheName = typeof proto[name].cache === "string" ? `m_${proto[name].cache}` : `m_${name}`;
      if ("cache" in proto[name]) {
        if (!supportsObjectCreate) {
          rows.push(
            `
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
}`.trim(),
          );
          if (proto[name].writable) {
            rows.push(
              `
JSC_DEFINE_CUSTOM_SETTER(${symbolName(typeName, name)}SetterWrap, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue encodedThisValue, EncodedJSValue encodedValue, PropertyName attributeName))
{
    auto& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    ${className(typeName)}* thisObject = jsCast<${className(typeName)}*>(JSValue::decode(encodedThisValue));
    JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);
    thisObject->${cacheName}.set(vm, thisObject, JSValue::decode(encodedValue));
    RELEASE_AND_RETURN(throwScope, true);
}`.trim(),
            );
          }
        } else {
          rows.push(
            `
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
}
`.trim(),
          );
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
      const fn = proto[name].fn;
      rows.push(`
JSC_DEFINE_HOST_FUNCTION(${symbolName(typeName, name)}Callback, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
  auto& vm = lexicalGlobalObject->vm();
  auto scope = DECLARE_THROW_SCOPE(vm);

  ${className(typeName)}* thisObject = jsDynamicCast<${className(typeName)}*>(callFrame->thisValue());

  if (UNLIKELY(!thisObject)) {
      scope.throwException(lexicalGlobalObject, Bun::createInvalidThisError(lexicalGlobalObject, callFrame->thisValue(), "${typeName}"_s));
      return {};
  }

  JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);

#if BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    const char* fileName = sourceOrigin.string().utf8().data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
      lastFileName = fileName;
    }

    JSC::EncodedJSValue result = ${symbolName(typeName, fn)}(thisObject->wrapped(), lexicalGlobalObject, callFrame${proto[name].passThis ? ", JSValue::encode(thisObject)" : ""});

    ASSERT_WITH_MESSAGE(!JSValue::decode(result).isEmpty() or DECLARE_CATCH_SCOPE(vm).exception() != 0, \"${typeName}.${proto[name].fn} returned an empty value without an exception\");

    ${
      !proto[name].DOMJIT
        ? ""
        : `
    JSValue decoded = JSValue::decode(result);
    if (thisObject->m_${fn}_expectedResultType) {
      if (decoded.isCell() && !decoded.isEmpty()) {
        ASSERT_WITH_MESSAGE(thisObject->m_${fn}_expectedResultType.value().has_value(), "DOMJIT function return type changed!");
        ASSERT_WITH_MESSAGE(thisObject->m_${fn}_expectedResultType.value().value() == decoded.asCell()->type(), "DOMJIT function return type changed!");
      } else {
        ASSERT_WITH_MESSAGE(!thisObject->m_${fn}_expectedResultType.value().has_value(), "DOMJIT function return type changed!");
      }
    } else if (!decoded.isEmpty()) {
      thisObject->m_${fn}_expectedResultType = decoded.isCell()
        ? std::optional<JSC::JSType>(decoded.asCell()->type())
        : std::optional<JSC::JSType>(std::nullopt);
    }`
    }

    return result;
#endif

  return ${symbolName(typeName, proto[name].fn)}(thisObject->wrapped(), lexicalGlobalObject, callFrame${proto[name].passThis ? ", JSValue::encode(thisObject)" : ""});
}

    `);
    }
  }

  if (cachedValues?.length) {
    for (const cacheName of cachedValues) {
      rows.push(writeBarrier(symbolName, typeName, cacheName, "m_" + cacheName));
    }
  }

  return rows.map(a => a.trim()).join("\n");
}
function allCachedValues(obj: ClassDefinition) {
  let values = (obj.values ?? []).slice().map(name => [name, `m_${name}`]);
  for (const name in obj.proto) {
    let cacheName = obj.proto[name].cache;
    if (cacheName === true) {
      cacheName = "m_" + name;
    } else if (cacheName) {
      cacheName = `m_${cacheName}`;
    }

    if (cacheName) {
      values.push([name, cacheName]);
    }
  }

  return values;
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
  const sizeEstimator = "static size_t estimatedSize(JSCell* cell, VM& vm);";

  var weakOwner = "";
  var weakInit = ``;
  if (obj.hasPendingActivity) {
    weakInit = `m_weakThis = JSC::Weak<${name}>(this, getOwner());`;
    weakOwner = `
    JSC::Weak<${name}> m_weakThis;


    static bool hasPendingActivity(void* ctx);

    class Owner final : public JSC::WeakHandleOwner {
      public:
          bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void* context, JSC::AbstractSlotVisitor& visitor, ASCIILiteral* reason) final
          {
              auto* controller = JSC::jsCast<${name}*>(handle.slot()->asCell());
              if (${name}::hasPendingActivity(controller->wrapped())) {
                  if (UNLIKELY(reason))
                    *reason = "has pending activity"_s;
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

  const final = obj.final ?? true;

  return `
  class ${name}${final ? " final" : ""} : public JSC::JSDestructibleObject {
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

        /**
         * Estimated size of the object from Zig including the JS wrapper.
         */
        static size_t estimatedSize(JSC::JSCell* cell, JSC::VM& vm);

        /**
         * Memory cost of the object from Zig, without necessarily having a JS wrapper alive.
         */
        static size_t memoryCost(void* ptr);

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

        ${domJITTypeCheckFields(proto, klass)}

        ${weakOwner}

        ${DECLARE_VISIT_CHILDREN}

        ${renderCachedFieldsHeader(typeName, klass, proto, values)}
        ${callbacks ? renderCallbacksHeader(typeName, obj.callbacks) : ""}
    };
    ${suffix}
  `.trim();
}

function domJITTypeCheckFields(proto, klass) {
  var output = "#if BUN_DEBUG\n";
  for (const name in proto) {
    const { DOMJIT, fn } = proto[name];
    if (!DOMJIT) continue;
    output += `std::optional<std::optional<JSC::JSType>> m_${fn}_expectedResultType = std::nullopt;\n`;
  }

  for (const name in klass) {
    const { DOMJIT, fn } = klass[name];
    if (!DOMJIT) continue;
    output += `std::optional<std::optional<JSC::JSType>> m_${fn}_expectedResultType = std::nullopt;\n`;
  }
  output += "#endif\n";
  return output;
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
    // Use appendHidden so it doesn't show up in the heap snapshot twice.
    DEFINE_VISIT_CHILDREN_LIST += "\n" + `    visitor.appendHidden(thisObject->m_callback_${name});`;
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
            auto size = ${symbolName(typeName, "estimatedSize")}(ptr);
visitor.reportExtraMemoryVisited(size);
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
    externs +=
      `extern JSC_CALLCONV bool JSC_HOST_CALL_ATTRIBUTES ${symbolName(typeName, "hasPendingActivity")}(void* ptr);` +
      "\n";
    output += `
    bool ${name}::hasPendingActivity(void* ctx) {
        return ${symbolName(typeName, "hasPendingActivity")}(ctx);
    }
`;
  }

  if (getInternalProperties) {
    externs += `extern JSC_CALLCONV JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${symbolName(typeName, "getInternalProperties")}(void* ptr, JSC::JSGlobalObject *globalObject, JSC::EncodedJSValue thisValue);`;
    output += `
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
    if (LIKELY(m_ctx)) {
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

  if (!obj.estimatedSize && !obj.memoryCost) {
    externs += `extern "C" const size_t ${symbolName(typeName, "ZigStructSize")};`;
  } else if (obj.memoryCost) {
    externs += `extern JSC_CALLCONV size_t ${symbolName(typeName, "memoryCost")}(void* ptr);`;
  }

  if (obj.memoryCost) {
    output += `
size_t ${name}::memoryCost(void* ptr) {
  return ptr ? ${symbolName(typeName, "memoryCost")}(ptr) : 0;
}
`;
  } else if (obj.estimatedSize) {
    output += `
size_t ${name}::memoryCost(void* ptr) {
  return ptr ? ${symbolName(typeName, "estimatedSize")}(ptr) : 0;
}
  `;
  } else {
    output += `
size_t ${name}::memoryCost(void* ptr) {
  return ptr ? ${symbolName(typeName, "ZigStructSize")} : 0;
}
  `;
  }

  output += `

size_t ${name}::estimatedSize(JSC::JSCell* cell, JSC::VM& vm) {
  auto* thisObject = jsCast<${name}*>(cell);
  auto* wrapped = thisObject->wrapped();
  return Base::estimatedSize(cell, vm) + ${name}::memoryCost(wrapped);
}

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

extern JSC_CALLCONV void* JSC_HOST_CALL_ATTRIBUTES ${typeName}__fromJS(JSC::EncodedJSValue value)  {
  JSC::JSValue decodedValue = JSC::JSValue::decode(value);
  if (decodedValue.isEmpty() || !decodedValue.isCell())
      return nullptr;

  JSC::JSCell* cell = decodedValue.asCell();
  ${className(typeName)}* object = JSC::jsDynamicCast<${className(typeName)}*>(cell);

  if (!object)
      return nullptr;

  return object->wrapped();
}

extern JSC_CALLCONV void* JSC_HOST_CALL_ATTRIBUTES ${typeName}__fromJSDirect(JSC::EncodedJSValue value) {
  JSC::JSValue decodedValue = JSC::JSValue::decode(value);
  ASSERT(decodedValue.isCell());

  JSC::JSCell* cell = decodedValue.asCell();
  ${className(typeName)}* object = JSC::jsDynamicCast<${className(typeName)}*>(cell);

  if (!object)
      return nullptr;

  Zig::GlobalObject* globalObject = jsDynamicCast<Zig::GlobalObject*>(object->globalObject());

  if (UNLIKELY(globalObject == nullptr || cell->structureID() != globalObject->${className(typeName)}Structure()->id())) {
    return nullptr;
  }

  return object->wrapped();
}

extern JSC_CALLCONV bool JSC_HOST_CALL_ATTRIBUTES ${typeName}__dangerouslySetPtr(JSC::EncodedJSValue value, void* ptr) {
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
        analyzer.setWrappedObjectForCell(cell, wrapped);
    }

    Base::analyzeHeap(cell, analyzer);
    ${allCachedValues(obj).length > 0 ? `auto& vm = thisObject->vm();` : ""}

    ${allCachedValues(obj)
      .map(
        ([name, cacheName]) => `
if (JSValue ${cacheName}Value = thisObject->${cacheName}.get()) {
  if (${cacheName}Value.isCell()) {
    const Identifier& id = Identifier::fromString(vm, "${name}"_s);
    analyzer.analyzePropertyNameEdge(cell, ${cacheName}Value.asCell(), id.impl());
  }
}`,
      )
      .join("\n  ")}
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

extern JSC_CALLCONV JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${typeName}__create(Zig::GlobalObject* globalObject, void* ptr) {
  auto &vm = globalObject->vm();
  JSC::Structure* structure = globalObject->${className(typeName)}Structure();
  ${className(typeName)}* instance = ${className(typeName)}::create(vm, globalObject, structure, ptr);
  ${
    obj.estimatedSize
      ? `
      auto size = ${symbolName(typeName, "estimatedSize")}(ptr);
      vm.heap.reportExtraMemoryAllocated(instance, size);`
      : ""
  }
  return JSValue::encode(instance);
}

${DEFINE_VISIT_CHILDREN}



    `.trim();

  return output;
}

function generateHeader(typeName, obj) {
  const fields = [
    generateClassHeader(typeName, obj).trim() + "\n\n",
    !(obj.final ?? true) ? generatePrototypeHeader(typeName, false) : null,
  ].filter(Boolean);

  return "\n" + fields.join("\n").trim();
}

function generateImpl(typeName, obj) {
  if (obj.zigOnly) return "";

  const proto = obj.proto;
  return [
    (obj.final ?? true) ? generatePrototypeHeader(typeName, true) : null,
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
    overridesToJS = false,
    estimatedSize,
    call = false,
    memoryCost,
    values = [],
    hasPendingActivity = false,
    structuredClone = false,
    getInternalProperties = false,
    callbacks = {},
  } = {} as ClassDefinition,
) {
  const exports = new Map<string, string>();

  if (hasPendingActivity) {
    exports.set("hasPendingActivity", symbolName(typeName, "hasPendingActivity"));
  }

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
        `extern fn ${protoSymbolName(typeName, name)}SetCachedValue(JSC.JSValue, *JSC.JSGlobalObject, JSC.JSValue) callconv(JSC.conv) void;

        extern fn ${protoSymbolName(typeName, name)}GetCachedValue(JSC.JSValue) callconv(JSC.conv) JSC.JSValue;

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

  function renderMethods() {
    const exports = new Map();
    var output = `
const JavaScriptCoreBindings = struct {

`;

    if (memoryCost) {
      exports.set("memoryCost", symbolName(typeName, "memoryCost"));
      output += `
    pub fn ${symbolName(typeName, "memoryCost")}(thisValue: *${typeName}) callconv(JSC.conv) usize {
      return @call(.always_inline, ${typeName}.memoryCost, .{thisValue});
    }
  `;
    }

    if (estimatedSize) {
      exports.set("estimatedSize", symbolName(typeName, "estimatedSize"));
      output += `
        pub fn ${symbolName(typeName, "estimatedSize")}(thisValue: *${typeName}) callconv(JSC.conv) usize {
          return @call(.always_inline, ${typeName}.estimatedSize, .{thisValue});
        }
      `;
    } else if (!memoryCost && !estimatedSize) {
      output += `
        export const ${symbolName(typeName, "ZigStructSize")}: usize = @sizeOf(${typeName});
      `;
    }

    if (hasPendingActivity) {
      exports.set("hasPendingActivity", symbolName(typeName, "hasPendingActivity"));
      output += `
        pub fn ${symbolName(typeName, "hasPendingActivity")}(thisValue: *${typeName}) callconv(JSC.conv) bool {
          return @call(.always_inline, ${typeName}.hasPendingActivity, .{thisValue});
        }
      `;
    }

    if (finalize) {
      exports.set("finalize", classSymbolName(typeName, "finalize"));
      output += `
        pub fn ${classSymbolName(typeName, "finalize")}(thisValue: *${typeName}) callconv(JSC.conv) void {
          if (comptime Environment.enable_logs) zig("<d>~${typeName} 0x{x:8}<r>", .{@intFromPtr(thisValue)});
          @call(.always_inline, ${typeName}.finalize, .{thisValue});
        }
      `;
    }

    if (construct && !noConstructor) {
      exports.set("construct", classSymbolName(typeName, "construct"));
      output += `
        pub fn ${classSymbolName(typeName, "construct")}(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(JSC.conv) ?*anyopaque {
          if (comptime Environment.enable_logs) zig("<r><blue>new<r> ${typeName}<d>({})<r>", .{callFrame});
          return @as(*${typeName}, ${typeName}.constructor(globalObject, callFrame) catch |err| switch (err) {
            error.JSError => return null,
            error.OutOfMemory => {
              globalObject.throwOutOfMemory() catch {};
              return null;
            },
          });
        }
      `;
    }

    if (call) {
      exports.set("call", classSymbolName(typeName, "call"));
      output += `
        pub fn ${classSymbolName(typeName, "call")}(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
          if (comptime Environment.enable_logs) zig("${typeName}<d>({})<r>", .{callFrame});
          return @call(.always_inline, JSC.toJSHostFunction(${typeName}.call), .{globalObject, callFrame});
        }
      `;
    }

    if (getInternalProperties) {
      exports.set("getInternalProperties", classSymbolName(typeName, "getInternalProperties"));
      output += `
        pub fn ${classSymbolName(typeName, "getInternalProperties")}(thisValue: *${typeName}, globalObject: *JSC.JSGlobalObject, thisValue: JSC.JSValue) callconv(JSC.conv) JSC.JSValue {
          if (comptime Environment.enable_logs) JSC.markBinding(@src());
          return @call(.always_inline, ${typeName}.getInternalProperties, .{thisValue, globalObject, thisValue});
        }
      `;
    }

    {
      const exportNames = name => zigExportName(exports, name => protoSymbolName(typeName, name), proto[name]);
      for (const name in proto) {
        const { getter, setter, accessor, fn, this: thisValue = false, cache, DOMJIT } = proto[name];
        const names = exportNames(name);
        if (names.getter) {
          output += `
        pub fn ${names.getter}(this: *${typeName}, ${thisValue ? "thisValue: JSC.JSValue," : ""} globalObject: *JSC.JSGlobalObject) callconv(JSC.conv) JSC.JSValue {
          if (comptime Environment.enable_logs) zig("<r><blue>get<r> ${typeName}<d>.<r>${name}", .{});
          return @call(.always_inline, ${typeName}.${getter}, .{this, ${thisValue ? "thisValue," : ""} globalObject});
        }
      `;
        }

        if (names.setter) {
          output += `
        pub fn ${names.setter}(this: *${typeName}, ${thisValue ? "thisValue: JSC.JSValue," : ""} globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) callconv(JSC.conv) bool {
          if (comptime Environment.enable_logs) zig("<r><blue>set<r> ${typeName}<d>.<r>${name} = {}", .{value});
          return @call(.always_inline, ${typeName}.${setter}, .{this, ${thisValue ? "thisValue," : ""} globalObject, value});
        }
      `;
        }

        if (names.fn) {
          if (names.DOMJIT) {
            const { args, returns } = DOMJIT;
            output += `
          pub fn ${names.DOMJIT}(thisValue: *${typeName}, globalObject: *JSC.JSGlobalObject, ${args
            .map(ZigDOMJITArgTypeDefinition)
            .join(", ")}) callconv(JSC.conv) JSC.JSValue {
            return @call(.always_inline, ${typeName}.${DOMJITName(fn)}, .{thisValue, globalObject, ${args.map((_, i) => `arg${i}`).join(", ")}});
          }
          `;
          }

          output += `
        pub fn ${names.fn}(thisValue: *${typeName}, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame${proto[name].passThis ? ", js_this_value: JSC.JSValue" : ""}) callconv(JSC.conv) JSC.JSValue {
          if (comptime Environment.enable_logs) zig("<d>${typeName}.<r>${name}<d>({})<r>", .{callFrame});
          return @call(.always_inline, JSC.toJSHostValue, .{globalObject, @call(.always_inline, ${typeName}.${fn}, .{thisValue, globalObject, callFrame${proto[name].passThis ? ", js_this_value" : ""}})});
        }
        `;
        }
      }
    }

    {
      const exportNames = name => zigExportName(exports, name => classSymbolName(typeName, name), klass[name]);
      for (const name in klass) {
        const { getter, setter, accessor, fn, this: thisValue = true, cache, DOMJIT } = klass[name];
        const names = exportNames(name);
        if (names.getter) {
          output += `
        pub fn ${names.getter}(globalObject: *JSC.JSGlobalObject, ${thisValue ? "thisValue: JSC.JSValue," : ""} propertyName: JSC.JSValue) callconv(JSC.conv) JSC.JSValue {
          if (comptime Environment.enable_logs) JSC.markBinding(@src());
          return @call(.always_inline, ${typeName}.${getter}, .{globalObject, ${thisValue ? "thisValue," : ""} propertyName});
        }
        `;
        }

        if (names.setter) {
          output += `
        pub fn ${names.setter}(globalObject: *JSC.JSGlobalObject, thisValue: JSC.JSValue, target: JSC.JSValue) callconv(JSC.conv) bool {
          if (comptime Environment.enable_logs) JSC.markBinding(@src());
          return @call(.always_inline, ${typeName}.${setter || accessor.setter}, .{thisValue, globalObject, target});
        }
        `;
        }

        if (names.fn) {
          if (DOMJIT) {
            const { args, returns } = DOMJIT;

            output += `
          pub fn ${names.DOMJIT}(globalObject: *JSC.JSGlobalObject, thisValue: JSC.JSValue, ${args
            .map(ZigDOMJITArgTypeDefinition)
            .join(", ")}) callconv(JSC.conv) JSC.JSValue {
            if (comptime Environment.enable_logs) JSC.markBinding(@src());
            return @call(.always_inline, ${typeName}.${DOMJITName(fn)}, .{thisValue, globalObject, ${args.map((_, i) => `arg${i}`).join(", ")}});
          }
          `;
          }

          output += `
        pub fn ${names.fn}(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
          if (comptime Environment.enable_logs) JSC.markBinding(@src());
          return @call(.always_inline, JSC.toJSHostFunction(${typeName}.${fn}), .{globalObject, callFrame});
        }
        `;
        }
      }
    }

    if (structuredClone) {
      exports.set("structuredClone", symbolName(typeName, "onStructuredCloneSerialize"));
      output += `
      pub fn ${symbolName(typeName, "onStructuredCloneSerialize")}(thisValue: *${typeName}, globalObject: *JSC.JSGlobalObject, ctx: *anyopaque, writeBytes: WriteBytesFn) callconv(JSC.conv) void {
        if (comptime Environment.enable_logs) JSC.markBinding(@src());
        @call(.always_inline, ${typeName}.onStructuredCloneSerialize, .{thisValue, globalObject, ctx, writeBytes});
      }
      `;

      if (structuredClone === "transferable") {
        exports.set("structuredClone_transferable", symbolName(typeName, "onStructuredCloneTransfer"));
        output += `
        pub fn ${exports.get("structuredClone_transferable")}(thisValue: *${typeName}, globalObject: *JSC.JSGlobalObject, ctx: *anyopaque, write: WriteBytesFn) callconv(JSC.conv) void {
          if (comptime Environment.enable_logs) JSC.markBinding(@src());
          @call(.always_inline, ${typeName}.onStructuredCloneTransfer, .{thisValue, globalObject, ctx, write});
        }
        `;
      }

      exports.set("structuredCloneDeserialize", symbolName(typeName, "onStructuredCloneDeserialize"));

      output += `
      pub fn ${symbolName(typeName, "onStructuredCloneDeserialize")}(globalObject: *JSC.JSGlobalObject, ptr: [*]u8, end: [*]u8) callconv(JSC.conv) JSC.JSValue {
        if (comptime Environment.enable_logs) JSC.markBinding(@src());
        return @call(.always_inline, JSC.toJSHostValue, .{ globalObject, @call(.always_inline, ${typeName}.onStructuredCloneDeserialize, .{globalObject, ptr, end}) });
      }
      `;
    } else {
      output += `
      pub fn ${symbolName(typeName, "onStructuredCloneSerialize")}(thisValue: *${typeName}, globalObject: *JSC.JSGlobalObject, ctx: *anyopaque, writeBytes: WriteBytesFn) callconv(JSC.conv) void {
        _ = thisValue;
        _ = globalObject;
        _ = ctx;
        _ = writeBytes;
        @compileLog("onStructuredCloneSerialize not implemented for ${typeName}");
      }
      `;
    }

    return (
      output.trim() +
      `
  };
  comptime {
${[...exports.values()].map(name => `      @export(JavaScriptCoreBindings.${name}, .{ .name = "${name}" });`).join("\n")}
    }`
    );
  }

  return `

pub const ${className(typeName)} = struct {
    const ${typeName} = Classes.${typeName};

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*${typeName} {
        if (comptime Environment.enable_logs) zig("<r>${typeName}<d>.<r>fromJS", .{});
        return ${symbolName(typeName, "fromJS")}(value);
    }

    /// Return the pointer to the wrapped object only if it is a direct instance of the type.
    /// If the object does not match the type, return null.
    /// If the object is a subclass of the type or has mutated the structure, return null.
    /// Note: this may return null for direct instances of the type if the user adds properties to the object.
    pub fn fromJSDirect(value: JSC.JSValue) ?*${typeName} {
        if (comptime Environment.enable_logs) zig("<r>${typeName}<d>.<r>fromJSDirect", .{});
        return ${symbolName(typeName, "fromJSDirect")}(value);
    }

    ${externs}

    ${
      !noConstructor
        ? `
    /// Get the ${typeName} constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        if (comptime Environment.enable_logs) zig("<r>${typeName}<d>.<r>getConstructor", .{});
        return ${symbolName(typeName, "getConstructor")}(globalObject);
    }
  `
        : ""
    }

    ${
      !overridesToJS
        ? `
    /// Create a new instance of ${typeName}
    pub fn toJS(this: *${typeName}, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        if (comptime Environment.enable_logs) zig("<r>${typeName}<d>.<r>toJS", .{});
        if (comptime Environment.allow_assert) {
            const value__ = ${symbolName(typeName, "create")}(globalObject, this);
            @import("root").bun.assert(value__.as(${typeName}).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return ${symbolName(typeName, "create")}(globalObject, this);
        }
    }`
        : ""
    }

    /// Modify the internal ptr to point to a new instance of ${typeName}.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*${typeName}) bool {
      JSC.markBinding(@src());
      return ${symbolName(typeName, "dangerouslySetPtr")}(value, ptr);
    }

    /// Detach the ptr from the thisValue
    pub fn detachPtr(_: *${typeName}, value: JSC.JSValue) void {
      JSC.markBinding(@src());
      bun.assert(${symbolName(typeName, "dangerouslySetPtr")}(value, null));
    }

    extern fn ${symbolName(typeName, "fromJS")}(JSC.JSValue) callconv(JSC.conv) ?*${typeName};
    extern fn ${symbolName(typeName, "fromJSDirect")}(JSC.JSValue) callconv(JSC.conv) ?*${typeName};
    extern fn ${symbolName(typeName, "getConstructor")}(*JSC.JSGlobalObject) callconv(JSC.conv) JSC.JSValue;
    extern fn ${symbolName(typeName, "create")}(globalObject: *JSC.JSGlobalObject, ptr: ?*${typeName}) callconv(JSC.conv) JSC.JSValue;

    /// Create a new instance of ${typeName} without validating it works.
    pub const toJSUnchecked = ${symbolName(typeName, "create")};

    extern fn ${typeName}__dangerouslySetPtr(JSC.JSValue, ?*${typeName}) callconv(JSC.conv) bool;

${renderMethods()}

};

`;
}

function generateLazyClassStructureHeader(typeName, { klass = {}, proto = {}, zigOnly = false }) {
  if (zigOnly) return "";

  return `
  JSC::Structure* ${className(typeName)}Structure() const { return m_${className(typeName)}.getInitializedOnMainThread(this); }
  JSC::JSObject* ${className(typeName)}Constructor() const { return m_${className(typeName)}.constructorInitializedOnMainThread(this); }
  JSC::JSObject* ${className(typeName)}Prototype() const { return m_${className(typeName)}.prototypeInitializedOnMainThread(this); }
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

const GENERATED_CLASSES_IMPL_HEADER_PRE = `
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
#include "ErrorCode+List.h"
#include "ErrorCode.h"
#include <JavaScriptCore/HeapAnalyzer.h>

#if !OS(WINDOWS)
#define JSC_CALLCONV "C"
#else
#define JSC_CALLCONV "C" SYSV_ABI
#endif


`;

const GENERATED_CLASSES_IMPL_HEADER_POST = `
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
const zig = bun.Output.scoped(.zig, true);

const wrapHostFunction = bun.gen_classes_lib.wrapHostFunction;
const wrapMethod = bun.gen_classes_lib.wrapMethod;
const wrapMethodWithThis = bun.gen_classes_lib.wrapMethodWithThis;
const wrapConstructor = bun.gen_classes_lib.wrapConstructor;
const wrapGetterCallback = bun.gen_classes_lib.wrapGetterCallback;
const wrapGetterWithValueCallback = bun.gen_classes_lib.wrapGetterWithValueCallback;

pub const StaticGetterType = fn(*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue) callconv(JSC.conv) JSC.JSValue;
pub const StaticSetterType = fn(*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue, JSC.JSValue) callconv(JSC.conv) bool;
pub const StaticCallbackType = JSC.JSHostFunctionType;
pub const WriteBytesFn = *const fn(*anyopaque, ptr: [*]const u8, len: u32) callconv(JSC.conv) void;

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

typedef SYSV_ABI void (*CppStructuredCloneableSerializeFunction)(CloneSerializer*, const uint8_t*, uint32_t);
typedef SYSV_ABI void (*ZigStructuredCloneableSerializeFunction)(void*, JSC::JSGlobalObject*, CloneSerializer*, CppStructuredCloneableSerializeFunction);

class StructuredCloneableSerialize {
  public:
    CppStructuredCloneableSerializeFunction cppWriteBytes;
    ZigStructuredCloneableSerializeFunction zigFunction;

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

  const allImpls = classes.map(a => generateImpl(a.name, a));
  await writeIfNotChanged(`${outBase}/ZigGeneratedClasses.cpp`, [
    GENERATED_CLASSES_IMPL_HEADER_PRE,
    externs.trim(),
    GENERATED_CLASSES_IMPL_HEADER_POST,
    allImpls.join("\n"),
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
