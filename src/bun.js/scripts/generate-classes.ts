import { readdirSync } from "fs";
import { resolve } from "path";
import type { Field, ClassDefinition } from "./class-definitions";

function symbolName(typeName, name) {
  return `${typeName}__${name}`;
}

function protoSymbolName(typeName, name) {
  return `${typeName}Prototype__${name}`;
}

function classSymbolName(typeName, name) {
  return `${typeName}Class__${name}`;
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

function appendSymbols(to, symbolName, prop) {
  var { defaultValue, getter, setter, accesosr, fn } = prop;

  if (accesosr) {
    getter = accesosr.getter;
    setter = accesosr.setter;
  }

  if (getter) {
    to.push([getter, symbolName(getter)]);
  }

  if (setter) {
    to.push([setter, symbolName(setter)]);
  }

  if (fn) {
    to.push([fn, symbolName(fn)]);
  }
}
function propRow(
  symbolName: (a: string, b: string) => string,
  typeName: string,
  name: string,
  prop: Field,
  isWrapped = true
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
  } = prop;

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

  if (fn !== undefined) {
    return `
{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${fn}), (intptr_t)(${
      length || 0
    }) } }
`.trim();
  } else if (getter && setter) {
    return `
    
{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(${getter}), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(${setter}) } }
`.trim();
  } else if (defaultValue) {
  } else if (getter) {
    return `{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(${getter}), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(0) } }
`.trim();
  } else if (setter) {
    return `{ "${name}"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(0), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(${setter}) } }
  `.trim();
  }

  throw "Unsupported property";
}

export function generateHashTable(
  nameToUse,
  symbolName,
  typeName,
  obj,
  props = {},
  wrapped
) {
  const rows = [];

  for (const name in props) {
    rows.push(propRow(symbolName, typeName, name, props[name], wrapped));
  }

  //   static const HashTableValue JSWebSocketPrototypeTableValues[] = {
  //     { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocketConstructor), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(0) } },
  //     { "URL"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_URL), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(0) } },
  //     { "url"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_url), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(0) } },
  //     { "readyState"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_readyState), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(0) } },
  //     { "bufferedAmount"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_bufferedAmount), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(0) } },
  //     { "onopen"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_onopen), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(setJSWebSocket_onopen) } },
  //     { "onmessage"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_onmessage), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(setJSWebSocket_onmessage) } },
  //     { "onerror"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_onerror), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(setJSWebSocket_onerror) } },
  //     { "onclose"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_onclose), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(setJSWebSocket_onclose) } },
  //     { "protocol"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_protocol), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(0) } },
  //     { "extensions"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_extensions), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(0) } },
  //     { "binaryType"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { (intptr_t) static_cast<PropertySlot::GetValueFunc>(jsWebSocket_binaryType), (intptr_t) static_cast<PutPropertySlot::PutValueFunc>(setJSWebSocket_binaryType) } },
  //     { "send"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsWebSocketPrototypeFunction_send), (intptr_t)(1) } },
  //     { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsWebSocketPrototypeFunction_close), (intptr_t)(0) } },
  //     { "CONNECTING"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { (long long)(0) } },
  //     { "OPEN"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { (long long)(1) } },
  //     { "CLOSING"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { (long long)(2) } },
  //     { "CLOSED"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { (long long)(3) } },
  // };
  return `
  static const HashTableValue ${nameToUse}TableValues[] = {
${rows.join("  ,\n")}
  };
`;
}

function generatePrototype(typeName, obj) {
  const proto = prototypeName(typeName);
  const { proto: protoFields } = obj;
  return `
${
  "construct" in obj
    ? `extern "C" void* ${classSymbolName(
        typeName,
        "construct"
      )}(JSC::JSGlobalObject*, JSC::CallFrame*);
JSC_DECLARE_CUSTOM_GETTER(js${typeName}Constructor);`
    : ""
}
${
  "finalize" in obj
    ? `extern "C" void ${classSymbolName(typeName, "finalize")}(void*);`
    : ""
}

${renderDecls(protoSymbolName, typeName, protoFields)}
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(${proto}, ${proto}::Base);

${generateHashTable(
  prototypeName(typeName),
  protoSymbolName,
  typeName,
  obj,

  protoFields,
  true
)}

const ClassInfo ${proto}::s_info = { "${typeName}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${proto}) };

${renderFieldsImpl(protoSymbolName, typeName, obj, protoFields)}

void ${proto}::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, ${className(
      typeName
    )}::info(), ${proto}TableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}



`;
}

function generateConstructorHeader(typeName) {
  const name = constructorName(typeName);
  const proto = prototypeName(typeName);

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
    };
    
  class ${name} final : public JSC::InternalFunction {
    public:
        using Base = JSC::InternalFunction;
        static ${name}* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, ${prototypeName(
    typeName
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
                [](auto& spaces) { return spaces.${clientSubspaceFor(
                  typeName
                )}Constructor.get(); },
                [](auto& spaces, auto&& space) { spaces.${clientSubspaceFor(
                  typeName
                )}Constructor = WTFMove(space); },
                [](auto& spaces) { return spaces.${subspaceFor(
                  typeName
                )}Constructor.get(); },
                [](auto& spaces, auto&& space) { spaces.${subspaceFor(
                  typeName
                )}Constructor = WTFMove(space); });
        }
    

        void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, ${prototypeName(
          typeName
        )}* prototype);
    
        // Must be defined for each specialization class.
        static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
        DECLARE_EXPORT_INFO;
    private:
        ${name}(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction nativeFunction)
            : Base(vm, structure, nativeFunction, nativeFunction)
    
        {
        }
    
        void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, ${prototypeName(
          typeName
        )}* prototype);
    };
    
    `;
}

function generateConstructorImpl(typeName, obj) {
  const name = constructorName(typeName);
  const { klass: fields } = obj;
  const hashTable =
    Object.keys(fields).length > 0
      ? generateHashTable(name, classSymbolName, typeName, obj, fields, false)
      : "";

  const hashTableIdentifier = hashTable.length ? `${name}TableValues` : "";
  return `
${renderStaticDecls(classSymbolName, typeName, fields)}
${hashTable}

void ${name}::finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, ${prototypeName(
    typeName
  )}* prototype)
{
    Base::finishCreation(vm, 0, "${typeName}"_s, PropertyAdditionMode::WithoutStructureTransition);
    ${
      hashTableIdentifier.length
        ? `reifyStaticProperties(vm, &${name}::s_info, ${hashTableIdentifier}, *this);`
        : ""
    }
    ASSERT(inherits(info()));
}

${name}* ${name}::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, ${prototypeName(
    typeName
  )}* prototype) {
    ${name}* ptr = new (NotNull, JSC::allocateCell<${name}>(vm)) ${name}(vm, structure, construct);
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

    void* ptr = ${classSymbolName(
      typeName,
      "construct"
    )}(globalObject, callFrame);

    if (UNLIKELY(!ptr)) {
      return JSValue::encode(JSC::jsUndefined());
    }

    ${className(typeName)}* instance = ${className(
    typeName
  )}::create(vm, globalObject, structure, ptr);

    return JSValue::encode(instance);
}

extern "C" EncodedJSValue ${typeName}__create(Zig::GlobalObject* globalObject, void* ptr) {
  auto &vm = globalObject->vm();
  JSC::Structure* structure = globalObject->${className(typeName)}Structure();
  ${className(typeName)}* instance = ${className(
    typeName
  )}::create(vm, globalObject, structure, ptr);
  return JSValue::encode(instance);
}

void ${name}::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, ${prototypeName(
    typeName
  )}* prototype)
{

}

const ClassInfo ${name}::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${name}) };


extern "C" EncodedJSValue ${typeName}__getConstructor(Zig::GlobalObject* globalObject) {
  return JSValue::encode(globalObject->${className(typeName)}Constructor());
}

      
      `;
}

function renderCachedFieldsHeader(typeName, klass, proto) {
  const rows = [];
  for (const name in klass) {
    if ("cache" in klass[name]) {
      rows.push(`mutable JSC::WriteBarrier<JSC::Unknown> m_${name};`);
    }
  }

  for (const name in proto) {
    if ("cache" in proto[name]) {
      rows.push(`mutable JSC::WriteBarrier<JSC::Unknown> m_${name};`);
    }
  }

  return rows.join("\n");
}

function renderDecls(symbolName, typeName, proto) {
  const rows = [];

  for (const name in proto) {
    if (
      "getter" in proto[name] ||
      ("accessor" in proto[name] && proto[name].getter)
    ) {
      rows.push(
        `extern "C" JSC::EncodedJSValue ${symbolName(
          typeName,
          proto[name].getter || proto[name].accessor.getter
        )}(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject);`,
        `
    JSC_DECLARE_CUSTOM_GETTER(${symbolName(typeName, name)}GetterWrap);
    `.trim(),
        "\n"
      );
    }

    if (
      "setter" in proto[name] ||
      ("accessor" in proto[name] && proto[name].setter)
    ) {
      rows
        .push(
          `extern "C" bool ${symbolName(
            typeName,
            proto[name].setter || proto[name].accessor.setter
          )}(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, EncoedJSValue value);`,
          `
      JSC_DECLARE_CUSTOM_SETTER(${symbolName(typeName, name)}SetterWrap);
      `,
          "\n"
        )
        .trim();
    }

    if ("fn" in proto[name]) {
      rows.push(
        `extern "C" EncodedJSValue ${symbolName(
          typeName,
          proto[name].fn
        )}(void* ptr, JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);`,

        `
        JSC_DECLARE_HOST_FUNCTION(${symbolName(typeName, name)}Callback);
        `.trim(),
        "\n"
      );
    }
  }

  return rows.join("\n");
}

function renderStaticDecls(symbolName, typeName, fields) {
  const rows = [];

  for (const name in fields) {
    if (
      "getter" in fields[name] ||
      ("accessor" in fields[name] && fields[name].getter)
    ) {
      rows.push(
        `extern "C" JSC_DECLARE_CUSTOM_GETTER(${symbolName(
          typeName,
          fields[name].getter || fields[name].accessor.getter
        )});`
      );
    }

    if (
      "setter" in fields[name] ||
      ("accessor" in fields[name] && fields[name].setter)
    ) {
      rows.push(
        `extern "C" JSC_DECLARE_CUSTOM_SETTER(${symbolName(
          typeName,
          fields[name].setter || fields[name].accessor.setter
        )});`
      );
    }

    if ("fn" in fields[name]) {
      rows.push(
        `extern "C" JSC_DECLARE_HOST_FUNCTION(${symbolName(
          typeName,
          fields[name].fn
        )});`
      );
    }
  }

  return rows.join("\n");
}

function renderFieldsImpl(
  symbolName: (typeName: string, name: string) => string,
  typeName: string,
  obj: ClassDefinition,
  proto: ClassDefinition["proto"]
) {
  const rows: string[] = [];

  if (obj.construct) {
    rows.push(`

JSC_DEFINE_CUSTOM_GETTER(js${typeName}Constructor, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* prototype = jsDynamicCast<${prototypeName(
      typeName
    )}*>(JSValue::decode(thisValue));

    if (UNLIKELY(!prototype))
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(globalObject->${className(typeName)}Constructor());
}    
    
`);
  }

  for (const name in proto) {
    if ("cache" in proto[name]) {
      rows.push(`
JSC_DEFINE_CUSTOM_GETTER(${symbolName(
        typeName,
        name
      )}GetterWrap, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    ${className(typeName)}* thisObject = jsCast<${className(
        typeName
      )}*>(JSValue::decode(thisValue));
      JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);
    
    if (JSValue cachedValue = thisObject->m_${name}.get())
        return JSValue::encode(cachedValue);
    
    JSC::JSValue result = JSC::JSValue::decode(
        ${symbolName(
          typeName,
          proto[name].getter
        )}(thisObject->wrapped(), globalObject)
    );
    RETURN_IF_EXCEPTION(throwScope, {});
    thisObject->m_${name}.set(vm, thisObject, result);
    RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
}
`);
    } else if (
      "getter" in proto[name] ||
      ("accessor" in proto[name] && proto[name].getter)
    ) {
      rows.push(`
JSC_DEFINE_CUSTOM_GETTER(${symbolName(
        typeName,
        name
      )}GetterWrap, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    auto& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject *globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    ${className(typeName)}* thisObject = jsCast<${className(
        typeName
      )}*>(JSValue::decode(thisValue));
    JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);
    JSC::EncodedJSValue result = ${symbolName(
      typeName,
      proto[name].getter
    )}(thisObject->wrapped(), globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    RELEASE_AND_RETURN(throwScope, result);
}
        `);
    }

    if (
      "setter" in proto[name] ||
      ("accessor" in proto[name] && proto[name].setter)
    ) {
      rows.push(
        `
JSC_DEFINE_CUSTOM_SETTER(${symbolName(
          typeName,
          name
        )}SetterWrap, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName))
{
    auto& vm = lexicalGlobalObject>
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    ${className(typeName)}* thisObject = jsCast<${className(
          typeName
        )}*>(JSValue::decode(thisValue));
    JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);
    auto result = ${symbolName(
      typeName,
      roto[name].setter || proto[name].accessor.setter
    )}(thisObject->wrapped(), lexicalGlobalObject, encodedValue);

    RELEASE_AND_RETURN(throwScope, result);
}
`
      );
    }

    if ("fn" in proto[name]) {
      rows.push(`
JSC_DEFINE_HOST_FUNCTION(${symbolName(
        typeName,
        name
      )}Callback, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = lexicalGlobalObject->vm();
    
    ${className(typeName)}* thisObject = jsDynamicCast<${className(
        typeName
      )}*>(callFrame->thisValue());

    if (UNLIKELY(!thisObject)) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    }

    JSC::EnsureStillAliveScope thisArg = JSC::EnsureStillAliveScope(thisObject);
    
    return ${symbolName(
      typeName,
      proto[name].fn
    )}(thisObject->wrapped(), lexicalGlobalObject, callFrame);
}
`);
    }
  }

  return rows.join("\n");
}

function generateClassHeader(typeName, obj) {
  var { klass, proto, JSType = "Object" } = obj;
  const name = className(typeName);

  const DECLARE_VISIT_CHILDREN = [
    ...Object.values(klass),
    ...Object.values(proto),
  ].find((a) => !!a.cache)
    ? "DECLARE_VISIT_CHILDREN;"
    : "";

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
                [](auto& spaces) { return spaces.${clientSubspaceFor(
                  typeName
                )}.get(); },
                [](auto& spaces, auto&& space) { spaces.${clientSubspaceFor(
                  typeName
                )} = WTFMove(space); },
                [](auto& spaces) { return spaces.${subspaceFor(
                  typeName
                )}.get(); },
                [](auto& spaces, auto&& space) { spaces.${subspaceFor(
                  typeName
                )} = WTFMove(space); });
        }
    
        static void destroy(JSC::JSCell*);
        static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
        {
            return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(static_cast<JSC::JSType>(${JSType}), StructureFlags), info());
        }
    
        static JSObject* createPrototype(VM& vm, JSDOMGlobalObject* globalObject);
    
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
        }
    
        void finishCreation(JSC::VM&);

        ${DECLARE_VISIT_CHILDREN}

        ${renderCachedFieldsHeader(typeName, klass, proto)}
    };
  `;
}

function generateClassImpl(typeName, obj) {
  const { klass: fields, finalize, proto, construct } = obj;
  const name = className(typeName);
  var symbolName = classSymbolName;

  const DEFINE_VISIT_CHILDREN_LIST = [
    ...Object.entries(fields),
    ...Object.entries(proto),
  ]
    .filter(([name, { cache }]) => !!cache)
    .map(([name]) => `    visitor.append(thisObject->m_${name});`)
    .join("\n");

  var DEFINE_VISIT_CHILDREN = "";
  if (DEFINE_VISIT_CHILDREN_LIST.length) {
    DEFINE_VISIT_CHILDREN = `
template<typename Visitor>
void ${name}::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ${name}* thisObject = jsCast<${name}*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
${DEFINE_VISIT_CHILDREN_LIST}
}

DEFINE_VISIT_CHILDREN(${name});
        `.trim();
  }

  var output = ``;

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
  ${className(typeName)}* object = JSC::jsDynamicCast<${className(
    typeName
  )}*>(JSValue::decode(value));
  if (!object)
      return nullptr;
      
  return object->wrapped();
}

extern "C" bool ${typeName}__dangerouslySetPtr(JSC::EncodedJSValue value, void* ptr) {
  ${className(typeName)}* object = JSC::jsDynamicCast<${className(
    typeName
  )}*>(JSValue::decode(value));
  if (!object)
      return false;
  
  object->m_ctx = ptr;
  return true;
}


extern "C" const size_t ${typeName}__ptrOffset = ${className(
    typeName
  )}::offsetOfWrapped();

void ${name}::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<${name}*>(cell);
    if (void* wrapped = thisObject->wrapped()) {
        // if (thisObject->scriptExecutionContext())
        //     analyzer.setLabelForCell(cell, "url " + thisObject->scriptExecutionContext()->url().string());
    }
    Base::analyzeHeap(cell, analyzer);
}

JSObject* ${name}::createPrototype(VM& vm, JSDOMGlobalObject* globalObject)
{
    return ${prototypeName(typeName)}::create(vm, globalObject, ${prototypeName(
    typeName
  )}::createStructure(vm, globalObject, globalObject->objectPrototype()));
}
      
${DEFINE_VISIT_CHILDREN}
 
    `.trim();

  return output;
}

function generateHeader(typeName, obj) {
  return (
    generateClassHeader(typeName, obj).trim() +
    "\n" +
    generateConstructorHeader(typeName).trim() +
    "\n"
  );
}

function generateImpl(typeName, obj) {
  const proto = obj.proto;
  return [
    Object.keys(proto).length > 0 && generatePrototype(typeName, obj).trim(),
    generateConstructorImpl(typeName, obj).trim(),
    Object.keys(proto).length > 0 && generateClassImpl(typeName, obj).trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function generateZig(
  typeName,
  { klass = {}, proto = {}, construct, finalize } = {} as ClassDefinition
) {
  const exports: [string, string][] = [];

  if (construct) {
    exports.push([`constructor`, classSymbolName(typeName, "construct")]);
  }

  if (finalize) {
    exports.push([`finalize`, classSymbolName(typeName, "finalize")]);
  }

  Object.values(klass).map((a) =>
    appendSymbols(exports, (name) => classSymbolName(typeName, name), a)
  );
  Object.values(proto).map((a) =>
    appendSymbols(exports, (name) => protoSymbolName(typeName, name), a)
  );

  function typeCheck() {
    var output = "";

    if (construct) {
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

    [...Object.values(proto)].forEach(({ getter, setter, accessor, fn }) => {
      if (accessor) {
        getter = accessor.getter;
        setter = accessor.setter;
      }

      if (getter) {
        output += `
          if (@TypeOf(${typeName}.${getter}) != GetterType) 
            @compileLog(
              "Expected ${typeName}.${getter} to be a getter"
            );
`;
      }

      if (setter) {
        output += `
          if (@TypeOf(${typeName}.${setter}) != SetterType) 
            @compileLog(
              "Expected ${typeName}.${setter} to be a setter"
            );`;
      }

      if (fn) {
        output += `
          if (@TypeOf(${typeName}.${fn}) != CallbackType) 
            @compileLog(
              "Expected ${typeName}.${fn} to be a callback"
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

    return output;
  }

  return `

pub const ${className(typeName)} = struct {
    const ${typeName} = Classes.${typeName};
    const GetterType = fn(*${typeName}, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn(*${typeName}, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn(*${typeName}, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*${typeName} {
        JSC.markBinding();
        return ${symbolName(typeName, "fromJS")}(value);
    }

    /// Get the ${typeName} constructor value.
    /// This loads lazily from the global object.
    pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        return ${symbolName(typeName, "getConstructor")}(globalObject);
    }

    /// Create a new instance of ${typeName}
    pub fn toJS(this: *${typeName}, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = ${symbolName(
              typeName,
              "create"
            )}(globalObject, this);
            std.debug.assert(value__.as(${typeName}).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return ${symbolName(typeName, "create")}(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of ${typeName}.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*${typeName}) bool {
      JSC.markBinding();
      return ${symbolName(typeName, "dangerouslySetPtr")}(value, ptr);
    }

    extern fn ${symbolName(typeName, "fromJS")}(JSC.JSValue) ?*${typeName};
    extern fn ${symbolName(
      typeName,
      "getConstructor"
    )}(*JSC.JSGlobalObject) JSC.JSValue;

    extern fn ${symbolName(
      typeName,
      "create"
    )}(globalObject: *JSC.JSGlobalObject, ptr: ?*${typeName}) JSC.JSValue;

    extern fn ${typeName}__dangerouslySetPtr(JSC.JSValue, ?*${typeName}) bool;

    comptime {
        ${typeCheck()}
        if (!JSC.is_bindgen) {
${exports
  .sort(([a], [b]) => a.localeCompare(b))
  .map(
    ([internalName, externalName]) =>
      `@export(${typeName}.${internalName}, .{.name = "${externalName}"});`
  )
  .join("\n          ")}
        }
    }
};

  
`;
}

function generateLazyClassStructureHeader(
  typeName,
  { klass = {}, proto = {} }
) {
  return `
        JSC::Structure* ${className(
          typeName
        )}Structure() { return m_${className(
    typeName
  )}.getInitializedOnMainThread(this); }
        JSC::JSObject* ${className(
          typeName
        )}Constructor() { return m_${className(
    typeName
  )}.constructorInitializedOnMainThread(this); }
        JSC::JSValue ${className(typeName)}Prototype() { return m_${className(
    typeName
  )}.prototypeInitializedOnMainThread(this); }
        JSC::LazyClassStructure m_${className(typeName)};
    `.trim();
}

function generateLazyClassStructureImpl(typeName, { klass = {}, proto = {} }) {
  return `
          m_${className(typeName)}.initLater(
              [](LazyClassStructure::Initializer& init) {
                 init.setPrototype(WebCore::${className(
                   typeName
                 )}::createPrototype(init.vm, reinterpret_cast<Zig::GlobalObject*>(init.global)));
                 init.setStructure(WebCore::${className(
                   typeName
                 )}::createStructure(init.vm, init.global, init.prototype));
                 init.setConstructor(WebCore::${constructorName(
                   typeName
                 )}::create(init.vm, init.global, WebCore::${constructorName(
    typeName
  )}::createStructure(init.vm, init.global, init.global->functionPrototype()), jsCast<WebCore::${prototypeName(
    typeName
  )}*>(init.prototype)));
              });
      
  
      `.trim();
}

const GENERATED_CLASSES_HEADER = `
// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by make codegen
#pragma once

#include "root.h"

namespace Zig {
}

#include "JSDOMWrapper.h"
#include <wtf/NeverDestroyed.h>

namespace WebCore {
using namespace Zig;
using namespace JSC;

`;

const GENERATED_CLASSES_FOOTER = `
}

`;

const GENERATED_CLASSES_IMPL_HEADER = `
// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by make codegen
#include "root.h"
 
#include "ZigGlobalObject.h"

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

void GlobalObject::initGeneratedLazyClasses() {
    ${initLaterFunctions.map((a) => a.trim()).join("\n    ")}
}
    
`.trim();
}

function visitLazyClasses(classes) {
  return `
  
template<typename Visitor>
void GlobalObject::visitGeneratedLazyClasses(GlobalObject *thisObject, Visitor& visitor)
{
      ${classes
        .map((a) => `thisObject->m_${className(a.name)}.visit(visitor);`)
        .join("\n      ")}
}
      
  `.trim();
}

const ZIG_GENERATED_CLASSES_HEADER = `
const JSC = @import("javascript_core");
const Classes = @import("./generated_classes_list.zig").Classes;
const Environment = @import("../../env.zig");
const std = @import("std");

pub const StaticGetterType = fn(*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue) callconv(.C) JSC.JSValue;
pub const StaticSetterType = fn(*JSC.JSGlobalObject, JSC.JSValue, JSC.JSValue, JSC.JSValue) callconv(.C) bool;
pub const StaticCallbackType = fn(*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;



`;

const directoriesToSearch = [
  resolve(`${import.meta.dir}/../api`),
  resolve(`${import.meta.dir}/../webcore`),
];

function findClasses() {
  var classes = [];
  for (let directory of directoriesToSearch) {
    readdirSync(directory).forEach((file) => {
      if (file.endsWith(".classes.ts")) {
        const result = require(`${directory}/${file}`);
        console.log("Generated", result.default.length, "classes from", file);
        for (let { name } of result.default) {
          console.log(`  - ${name}`);
        }

        classes.push(...result.default);
      }
    });
  }
  return classes;
}

const classes = findClasses();

await Bun.write(`${import.meta.dir}/../bindings/generated_classes.zig`, [
  ZIG_GENERATED_CLASSES_HEADER,
  ...classes.map((a) => generateZig(a.name, a).trim()).join("\n"),
]);
await Bun.write(`${import.meta.dir}/../bindings/ZigGeneratedClasses.h`, [
  GENERATED_CLASSES_HEADER,
  ...classes.map((a) => generateHeader(a.name, a)),
  GENERATED_CLASSES_FOOTER,
]);
await Bun.write(`${import.meta.dir}/../bindings/ZigGeneratedClasses.cpp`, [
  GENERATED_CLASSES_IMPL_HEADER,
  ...classes.map((a) => generateImpl(a.name, a)),
  GENERATED_CLASSES_IMPL_FOOTER,
]);
await Bun.write(
  `${import.meta.dir}/../bindings/ZigGeneratedClasses+lazyStructureHeader.h`,
  classes.map((a) => generateLazyClassStructureHeader(a.name, a)).join("\n")
);

await Bun.write(
  `${import.meta.dir}/../bindings/ZigGeneratedClasses+DOMClientIsoSubspaces.h`,
  classes.map((a) =>
    [
      `std::unique_ptr<GCClient::IsoSubspace> ${clientSubspaceFor(a.name)};`,
      `std::unique_ptr<GCClient::IsoSubspace> ${clientSubspaceFor(
        a.name
      )}Constructor;`,
    ].join("\n")
  )
);

await Bun.write(
  `${import.meta.dir}/../bindings/ZigGeneratedClasses+DOMIsoSubspaces.h`,
  classes.map((a) =>
    [
      `std::unique_ptr<IsoSubspace> ${subspaceFor(a.name)};`,
      `std::unique_ptr<IsoSubspace> ${subspaceFor(a.name)}Constructor;`,
    ].join("\n")
  )
);

await Bun.write(
  `${import.meta.dir}/../bindings/ZigGeneratedClasses+lazyStructureImpl.h`,
  initLazyClasses(
    classes.map((a) => generateLazyClassStructureImpl(a.name, a))
  ) +
    "\n" +
    visitLazyClasses(classes)
);

export {};
