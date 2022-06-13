const classes = ["ArrayBufferSink"];

function header() {
  function classTemplate(idName) {
    const name = `JS${idName}`;
    const constructor = `${name}Constructor`;
    const constructorName = `JS${name}Constructor`;

    return `class ${constructor} final : public JSC::InternalFunction {                                                                                                     
        public:                                                                                                                                                                     
            using Base = JSC::InternalFunction;                                                                                                                                     
            static ${constructor}* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype); 
            static constexpr SinkID Sink = SinkID::${idName};
                                                                                                                                                                                    
            static constexpr unsigned StructureFlags = Base::StructureFlags;                                                                                                        
            static constexpr bool needsDestruction = false;                                                                                                                         
                                                                                                                                                                                    
            DECLARE_EXPORT_INFO;                                                                                                                                                    
            template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)                                                                
            {                                                                                                                                                                       
                if constexpr (mode == JSC::SubspaceAccess::Concurrently)                                                                                                            
                    return nullptr;                                                                                                                                                 
                return WebCore::subspaceForImpl<${constructor}, WebCore::UseCustomHeapCellType::No>(                                                                    
                    vm,                                                                                                                                                             
                    [](auto& spaces) { return spaces.m_clientSubspaceForJSSinkConstructor.get(); },                                                                                 
                    [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSinkConstructor = WTFMove(space); },                                                               
                    [](auto& spaces) { return spaces.m_subspaceForJSSinkConstructor.get(); },                                                                                       
                    [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSinkConstructor = WTFMove(space); });                                                                    
            }                                                                                                                                                                       
                                                                                                                                                                                    
            static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)                                                          
            {                                                                                                                                                                       
                return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());                                                 
            }                                                                                                                                                                       
            void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype);   
            
            
            // Must be defined for each specialization class.
            static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
                                                                                                                                                               
        private:                                                                                                                                                                    
            ${constructor}(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction nativeFunction)                                                                  
                : Base(vm, structure, nativeFunction, nativeFunction)                                                                                                               
                                                                                                                                                                                    
            {                                                                                                                                                                       
            }                                                                                                                                                                       
                                                                                                                                                                                    
            void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype);                                                     
        };                                                                                                                                                                          
                                                                                                                                                                                    
        class ${name} final : public JSC::JSDestructibleObject {                                                                                                              
        public:                                                                                                                                                                     
            using Base = JSC::JSDestructibleObject;                                                                                                                                 
            static ${name}* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* sinkPtr);       
            static constexpr SinkID Sink = SinkID::${idName};                                          
                                                                                                                                                                                    
            DECLARE_EXPORT_INFO;                                                                                                                                                    
            template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)                                                                
            {                                                                                                                                                                       
                if constexpr (mode == JSC::SubspaceAccess::Concurrently)                                                                                                            
                    return nullptr;                                                                                                                                                 
                return WebCore::subspaceForImpl<${name}, WebCore::UseCustomHeapCellType::No>(                                                                                 
                    vm,                                                                                                                                                             
                    [](auto& spaces) { return spaces.m_clientSubspaceForJSSink.get(); },                                                                                            
                    [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSink = WTFMove(space); },                                                                          
                    [](auto& spaces) { return spaces.m_subspaceForJSSink.get(); },                                                                                                  
                    [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSink = WTFMove(space); });                                                                               
            }                                                                                                                                                                       
                                                                                                                                                                                    
            static void destroy(JSC::JSCell*);                                                                                                                                      
            static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)                                                          
            {                                                                                                                                                                       
                return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());                                                 
            }                                                                                                                                                                       
                                                                                                                                                                                    
            ~${name}();                                                                                                                                                       
                                                                                                                                                                                    
            void* wrapped() const { return m_sinkPtr; }                                                                                                                             
                                                                                                                                                                                    
            static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);                                                                                                                   
                                                                                                                                                                                    
            void* m_sinkPtr;
                                                                                                                                                                                    
            ${name}(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr)                                                                                                    
                : Base(vm, structure)                                                                                                                                               
            {                                                                                                                                                                       
                m_sinkPtr = sinkPtr;                                                                                                                                                
            }                                                                                                                                                                       
                                                                                                                                                                                    
            void finishCreation(JSC::VM&);                                                                                                                                          
        };
JSC_DECLARE_CUSTOM_GETTER(function${idName}__getter);        

        `;
  }

  const outer = `
// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated by ${import.meta.path} at ${new Date().toISOString()}
//
#pragma once

#include "root.h"

#include "JSDOMWrapper.h"
#include "wtf/NeverDestroyed.h"

#include "Sink.h"

extern "C" bool JSSink_isSink(JSC::JSGlobalObject*, JSC::EncodedJSValue);

namespace WebCore {
using namespace JSC;
`;

  const bottom = `JSObject* createJSSinkPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, WebCore::SinkID sinkID);

} // namespace WebCore
`;
  var templ = outer;
  for (let name of classes) {
    templ += classTemplate(name) + "\n";
  }
  templ += bottom;
  return templ;
}

async function implementation() {
  const head = `
// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated by ${import.meta.path} at ${new Date().toISOString()}
// To regenerate this file, run:
//
//  bun src/javascript/jsc/generate-jssink.js
//
#include "root.h"
#include "JSSink.h"

#include "ActiveDOMObject.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "IDLTypes.h"
// #include "JSBlob.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperation.h"
#include "JSDOMWrapperCache.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/HeapAnalyzer.h"

#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "wtf/GetPtr.h"
#include "wtf/PointerPreparations.h"
#include "wtf/URL.h"
#include "JavaScriptCore/BuiltinNames.h"

#include "JSBufferEncodingType.h"
#include "JSBufferPrototypeBuiltins.h"
#include "JSBufferConstructorBuiltins.h"
#include "JavaScriptCore/JSBase.h"
#if ENABLE(MEDIA_SOURCE)
#include "BufferMediaSource.h"
#include "JSMediaSource.h"
#endif

// #include "JavaScriptCore/JSTypedArrayViewPrototype.h"
#include "JavaScriptCore/JSArrayBufferViewInlines.h"

namespace WebCore {
using namespace JSC;


`;
  var templ = head;

  for (let name of classes) {
    templ += `
JSC_DEFINE_CUSTOM_GETTER(function${name}__getter, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);

    return JSC::JSValue::encode(globalObject->${name}());
}
`;
  }

  templ += `
${(await Bun.file(import.meta.dir + "/bindings/JSSink+custom.h").text()).trim()}
`;

  const footer = `
} // namespace WebCore

`;

  for (let name of classes) {
    const constructorName = `JS${name}Constructor`;
    const className = `JS${name}`;
    const prototypeName = `JS${name}Prototype`;

    templ += `
#pragma mark - ${name}

class ${prototypeName} final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static ${prototypeName}* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        ${prototypeName}* ptr = new (NotNull, JSC::allocateCell<${prototypeName}>(vm)) ${prototypeName}(vm, globalObject, structure);
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
    ${prototypeName}(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(${prototypeName}, ${prototypeName}::Base);



const ClassInfo ${prototypeName}::s_info = { "${name}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${prototypeName}) };
const ClassInfo ${className}::s_info = { "${name}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${className}) };
const ClassInfo ${constructorName}::s_info = { "${name}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${constructorName}) };

${className}::~${className}()
{
    if (m_sinkPtr) {
        ${name}__finalize(m_sinkPtr);
    }
}


`;

    templ += `

${constructorName}* ${constructorName}::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSObject* prototype)
{
    ${constructorName}* ptr = new (NotNull, JSC::allocateCell<${constructorName}>(vm)) ${constructorName}(vm, structure, ${name}__construct);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

${className}* ${className}::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* sinkPtr)
{
    ${className}* ptr = new (NotNull, JSC::allocateCell<${className}>(vm)) ${className}(vm, structure, sinkPtr);
    ptr->finishCreation(vm);
    return ptr;
}

void ${constructorName}::finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    initializeProperties(vm, globalObject, prototype);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${constructorName}::construct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) {
    return ${name}__construct(globalObject, callFrame);
}


void ${constructorName}::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, JSObject* prototype)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "${name}"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
}

void ${prototypeName}::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, ${className}::info(), ${className}PrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

void ${className}::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void ${className}::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<${className}*>(cell);
    if (void* wrapped = thisObject->wrapped()) {
        analyzer.setWrappedObjectForCell(cell, wrapped);
        // if (thisObject->scriptExecutionContext())
        //     analyzer.setLabelForCell(cell, "url " + thisObject->scriptExecutionContext()->url().string());
    }
    Base::analyzeHeap(cell, analyzer);
}

void ${className}::destroy(JSCell* cell)
{
    static_cast<${className}*>(cell)->${className}::~${className}();
}


`;
  }

  templ += `
  JSObject* createJSSinkPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, SinkID sinkID)
  {
      switch (sinkID) {
    `;
  for (let name of classes) {
    templ += `
    case ${name}:
        return JS${name}Prototype::create(vm, globalObject, JS${name}Prototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
`;
  }
  templ += `
default: 
    RELEASE_ASSERT_NOT_REACHED();
    }
}`;

  templ += footer;

  for (let name of classes) {
    templ += `
extern "C" JSC__JSValue ${name}__createObject(JSC__JSGlobalObject* arg0, void* sinkPtr)
{
    auto& vm = arg0->vm();
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::JSValue prototype = globalObject->${name}Prototype();
    JSC::Structure* structure = WebCore::JS${name}::createStructure(vm, globalObject, prototype);
    return JSC::JSValue::encode(WebCore::JS${name}::create(vm, globalObject, structure, sinkPtr));
}

extern "C" void* ${name}__fromJS(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1)
{
    JSC::VM& vm = WebCore::getVM(arg0);
    if (auto* sink = JSC::jsDynamicCast<WebCore::JS${name}*>(JSC::JSValue::decode(JSValue1)))
        return sink->wrapped();

    return nullptr;
}
`;
    return templ;
  }
}

await Bun.write(import.meta.dir + "/bindings/JSSink.h", header());
await Bun.write(
  import.meta.dir + "/bindings/JSSink.cpp",
  await implementation()
);
