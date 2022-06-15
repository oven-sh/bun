const classes = [ "ArrayBufferSink" ];

function names(name) {
  return {
    constructor : `JS${name}Constructor`,
    className : `JS${name}`,
    controller : `JSReadable${name}Controller`,
    controllerName : `Readable${name}Controller`,
    prototypeName : `JS${name}Prototype`,
    controllerPrototypeName : `JSReadable${name}ControllerPrototype`,
  };
}
function header() {
  function classTemplate(name) {
    const {constructor, className, controller} = names(name);

    return `class ${
        constructor} final : public JSC::InternalFunction {                                                                                                     
        public:                                                                                                                                                                     
            using Base = JSC::InternalFunction;                                                                                                                                     
            static ${
        constructor}* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype); 
            static constexpr SinkID Sink = SinkID::${name};
                                                                                                                                                                                    
            static constexpr unsigned StructureFlags = Base::StructureFlags;                                                                                                        
            static constexpr bool needsDestruction = false;                                                                                                                         
                                                                                                                                                                                    
            DECLARE_EXPORT_INFO;                                                                                                                                                    
            template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)                                                                
            {                                                                                                                                                                       
                if constexpr (mode == JSC::SubspaceAccess::Concurrently)                                                                                                            
                    return nullptr;                                                                                                                                                 
                return WebCore::subspaceForImpl<${
        constructor}, WebCore::UseCustomHeapCellType::No>(                                                                    
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
            ${
        constructor}(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction nativeFunction)                                                                  
                : Base(vm, structure, nativeFunction, nativeFunction)                                                                                                               
                                                                                                                                                                                    
            {                                                                                                                                                                       
            }                                                                                                                                                                       
                                                                                                                                                                                    
            void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype);                                                     
        };                                                                                                                                                                          
                                                                                                                                                                                    
        class ${
        className} final : public JSC::JSDestructibleObject {                                                                                                              
        public:                                                                                                                                                                     
            using Base = JSC::JSDestructibleObject;                                                                                                                                 
            static ${
        className}* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* sinkPtr);       
            static constexpr SinkID Sink = SinkID::${
        name};                                          
                                                                                                                                                                                    
            DECLARE_EXPORT_INFO;                                                                                                                                                    
            template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)                                                                
            {                                                                                                                                                                       
                if constexpr (mode == JSC::SubspaceAccess::Concurrently)                                                                                                            
                    return nullptr;                                                                                                                                                 
                return WebCore::subspaceForImpl<${
        className}, WebCore::UseCustomHeapCellType::No>(                                                                                 
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
                                                                                                                                                                                    
            ~${
        className}();                                                                                                                                                       
                                                                                                                                                                                    
            void* wrapped() const { return m_sinkPtr; }                                                                                                                             

            void detach() {
                m_sinkPtr = nullptr;
            }                       

            static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);                                                                                                                   
                                                                                                                                                                                    
            void* m_sinkPtr;
                                                                                                                                                                                    
            ${
        className}(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr)                                                                                                    
                : Base(vm, structure)                                                                                                                                               
            {                                                                                                                                                                       
                m_sinkPtr = sinkPtr;                                                                                                                                                
            }                                                                                                                                                                       
                                                                                                                                                                                    
            void finishCreation(JSC::VM&);                                                                                                                                          
        };

        class ${
        controller} final : public JSC::JSDestructibleObject {                                                                                                              
            public:                                                                                                                                                                     
                using Base = JSC::JSDestructibleObject;                                                                                                                                 
                static ${
        controller}* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* sinkPtr);       
                static constexpr SinkID Sink = SinkID::${
        name};                                          
                                                                                                                                                                                        
                DECLARE_EXPORT_INFO;                                                                                                                                                    
                template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)                                                                
                {                                                                                                                                                                       
                    if constexpr (mode == JSC::SubspaceAccess::Concurrently)                                                                                                            
                        return nullptr;                                                                                                                                                 
                    return WebCore::subspaceForImpl<${
        controller}, WebCore::UseCustomHeapCellType::No>(                                                                                 
                        vm,                                                                                                                                                             
                        [](auto& spaces) { return spaces.m_clientSubspaceForJSSinkController.get(); },                                                                                            
                        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSinkController = WTFMove(space); },                                                                          
                        [](auto& spaces) { return spaces.m_subspaceForJSSinkController.get(); },                                                                                                  
                        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSinkController = WTFMove(space); });                                                                               
                }                                                                                                                                                                       
                                                                                                                                                                                        
                static void destroy(JSC::JSCell*);                                                                                                                                      
                static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)                                                          
                {                                                                                                                                                                       
                    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());                                                 
                }                                                                                                                                                                       
                                                                                                                                                                                        
                ~${
        controller}();                                                                                                                                                       


                void* wrapped() const { return m_sinkPtr; }    
                void detach() {
                    m_sinkPtr = nullptr;
                }

                void start(JSC::JSGlobalObject *globalObject, JSC::JSValue readableStream, JSC::JSFunction *onPull, JSC::JSFunction *onClose);
                DECLARE_VISIT_CHILDREN;
                                                                                                                                                                                        
                static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);                                                                                                                   
                                                                                                                                                                                        
                void* m_sinkPtr;
                mutable WriteBarrier<JSC::JSFunction> m_onPull;
                mutable WriteBarrier<JSC::JSFunction> m_onClose;
                JSC::Weak<Unknown> m_weakReadableStream;
                                                                                                                                                                                        
                ${
        controller}(JSC::VM& vm, JSC::Structure* structure, void* sinkPtr)                                                                                                    
                    : Base(vm, structure)                                                                                                                                               
                {                                                                                                                                                                       
                    m_sinkPtr = sinkPtr;                                                                                                                                                
                }                                                                                                                                                                       
                                                                                                                                                                                        
                void finishCreation(JSC::VM&);                                                                                                                                          
            };

JSC_DECLARE_CUSTOM_GETTER(function${name}__getter);



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

JSC_DECLARE_HOST_FUNCTION(functionStartDirectStream);
`;

  const bottom =
      `JSObject* createJSSinkPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, WebCore::SinkID sinkID);

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




JSC_DEFINE_HOST_FUNCTION(functionStartDirectStream, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame *callFrame))
{
    
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);

    JSC::JSValue readableStream = callFrame->argument(0);
    JSC::JSValue onPull = callFrame->argument(1);
    JSC::JSValue onClose = callFrame->argument(2);
    if (!readableStream.isObject()) {
        scope.throwException(callFrame, JSC::createTypeError(callFrame, "Expected ReadableStream"_s))
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    if (!onPull.isObject() || !onPull.isCallable()) {
        onPull = JSC::jsUndefined();
    }

    if (!onClose.isObject() || !onClose.isCallable()) {
        onClose = JSC::jsUndefined();
    }

`;
  var templ = head;

  var isFirst = true;
  for (let name of classes) {
    const {
      className,
      controller,
      prototypeName,
      controllerPrototypeName,
      constructor,
    } = names(name);

    templ += `

    ${isFirst ? "" : "else"} if (${controller}* ${
        name}Controller = JSC::jsDynamicCast<${
        controller}*>(callFrame->thisValue())) {
        if (${name}Controller->wrapped() == nullptr) {
            scope.throwException(callFrame, JSC::createTypeError(callFrame, "Controller is already closed"_s));
            return JSC::JSValue::encode(JSC::jsUndefined());
        }

        ${name}Controller->start(globalObject, readableStream, onPull, onClose);
    }
}
`;
    isFirst = false;
  }

  templ += `
    else {
        scope.throwException(callFrame, JSC::createTypeError(callFrame, "Unknown direct controller. This is a bug in Bun."_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsUndefined()));
}
`;

  for (let name of classes) {
    const {
      className,
      controller,
      prototypeName,
      controllerName,
      controllerPrototypeName,
      constructor,
    } = names(name);

    templ += `
JSC_DEFINE_CUSTOM_GETTER(function${
        name}__getter, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = lexicalGlobalObject->vm();
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);

    return JSC::JSValue::encode(globalObject->${name}());
}


JSC_DECLARE_HOST_FUNCTION(${controller}__close);
JSC_DEFINE_HOST_FUNCTION(${
        controller}__close, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame *callFrame))
{
    
    auto& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    ${controller}* controller = JSC::jsDynamicCast<${
        controller}*>(callFrame->thisValue());
    if (!${controller}) {
        scope.throwException(callFrame, JSC::createTypeError(callFrame, "Expected ${
        controller}"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    void *ptr = controller->wrapped();
    if (ptr == nullptr) {
        scope.throwException(callFrame, JSC::createTypeError(callFrame, "Controller is already closed"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    controller->detach();
    ${name}__close(ptr, callFrame->argument(0));
    return JSC::JSValue::encode(JSC::jsUndefined());
}




static const HashTableValue JS${name}PrototypeTableValues[]
    = {
          { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${
        name}__close), (intptr_t)(0) } },
          { "drain"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${
        name}__drain), (intptr_t)(1) } },
          { "end"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${
        name}__end), (intptr_t)(0) } },
          { "start"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${
        name}__start), (intptr_t)(1) } },
          { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${
        name}__write), (intptr_t)(1) } },
      };

static const HashTableValue ${controllerPrototypeName}TableValues[]
      = {
            { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${
        controller}__close), (intptr_t)(0) } },
            { "drain"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${
        name}__drain), (intptr_t)(1) } },
            { "end"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${
        name}__end), (intptr_t)(0) } },
            { "start"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(function${
        controller}__start), (intptr_t)(1) } },
            { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(${
        name}__write), (intptr_t)(1) } },
        };

`;
  }

  templ += `
${(await Bun.file(import.meta.dir + "/bindings/JSSink+custom.h").text()).trim()}
`;

  const footer = `
} // namespace WebCore

`;

  for (let name of classes) {
    const {
      className,
      controller,
      prototypeName,
      controllerPrototypeName,
      constructor,
      controllerName,
    } = names(name);
    templ += `
#pragma mark - ${name}

class ${prototypeName} final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static ${
        prototypeName}* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        ${prototypeName}* ptr = new (NotNull, JSC::allocateCell<${
        prototypeName}>(vm)) ${prototypeName}(vm, globalObject, structure);
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

const ClassInfo ${prototypeName}::s_info = { "${
        name}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${
        prototypeName}) };
const ClassInfo ${className}::s_info = { "${
        name}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${
        className}) };
const ClassInfo ${constructor}::s_info = { "${
        name}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${
        constructor}) };


const ClassInfo ${controllerPrototypeName}::s_info = { "${
        controllerName}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${
        controllerPrototypeName}) };
const ClassInfo ${controller}::s_info = { "${
        controllerName}"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(${
        controller}) };

${className}::~${className}()
{
    if (m_sinkPtr) {
        ${name}__finalize(m_sinkPtr);
    }
}


${controller}::~${controller}()
{
    if (m_sinkPtr) {
        ${name}__finalize(m_sinkPtr);
    }
}


`;

    templ += `

${constructor}* ${
        constructor}::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSObject* prototype)
{
    ${constructor}* ptr = new (NotNull, JSC::allocateCell<${
        constructor}>(vm)) ${constructor}(vm, structure, ${name}__construct);
    ptr->finishCreation(vm, globalObject, prototype);
    return ptr;
}

${className}* ${
        className}::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* sinkPtr)
{
    ${className}* ptr = new (NotNull, JSC::allocateCell<${className}>(vm)) ${
        className}(vm, structure, sinkPtr);
    ptr->finishCreation(vm);
    return ptr;
}

${controller}* ${
        controller}::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* sinkPtr)
{
    ${controller}* ptr = new (NotNull, JSC::allocateCell<${controller}>(vm)) ${
        controller}(vm, structure, sinkPtr);
    ptr->finishCreation(vm);
    return ptr;
}

void ${constructor}::finishCreation(VM& vm, JSC::JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    initializeProperties(vm, globalObject, prototype);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES ${
        constructor}::construct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) {
    return ${name}__construct(globalObject, callFrame);
}


void ${constructor}::initializeProperties(VM& vm, JSC::JSGlobalObject* globalObject, JSObject* prototype)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "${name}"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
}

void ${prototypeName}::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, ${className}::info(), ${
        className}PrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

void ${controllerPrototypeName}::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, ${controller}::info(), ${
        controller}PrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

void ${className}::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void ${controller}::finishCreation(VM& vm)
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

void ${controller}::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<${controller}*>(cell);
    if (void* wrapped = thisObject->wrapped()) {
        analyzer.setWrappedObjectForCell(cell, wrapped);
        // if (thisObject->scriptExecutionContext())
        //     analyzer.setLabelForCell(cell, "url " + thisObject->scriptExecutionContext()->url().string());
    }
    Base::analyzeHeap(cell, analyzer);
}


template<typename Visitor>
void ${controller}::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = jsCast<${controller}*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_onPull);
    visitor.append(thisObject->m_onClose);
    visitor.append(thisObject->m_weakReadableStream);
}

DEFINE_VISIT_CHILDREN(${controller});


void ${className}::destroy(JSCell* cell)
{
    static_cast<${className}*>(cell)->${className}::~${className}();
}


void ${controller}::destroy(JSCell* cell)
{
    static_cast<${controller}*>(cell)->${controller}::~${controller}();
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
        return JS${name}Prototype::create(vm, globalObject, JS${
        name}Prototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
`;
  }
  templ += `
default: 
    RELEASE_ASSERT_NOT_REACHED();
    }
}`;

  templ += footer;

  for (let name of classes) {
    const {
      className,
      controller,
      prototypeName,
      controllerPrototypeName,
      constructor,
    } = names(name);

    templ += `
extern "C" JSC__JSValue ${
        name}__createObject(JSC__JSGlobalObject* arg0, void* sinkPtr)
{
    auto& vm = arg0->vm();
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::JSValue prototype = globalObject->${name}Prototype();
    JSC::Structure* structure = WebCore::JS${
        name}::createStructure(vm, globalObject, prototype);
    return JSC::JSValue::encode(WebCore::JS${
        name}::create(vm, globalObject, structure, sinkPtr));
}

extern "C" void* ${
        name}__fromJS(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1)
{
    JSC::VM& vm = WebCore::getVM(arg0);
    if (auto* sink = JSC::jsDynamicCast<WebCore::JS${
        name}*>(JSC::JSValue::decode(JSValue1)))
        return sink->wrapped();

    return nullptr;
}

extern "C" JSC__JSValue ${
        name}__assignToStream(JSC__JSGlobalObject* arg0, JSC__JSValue stream, void* sinkPtr, int32_t *bunNativeTag, void** bunNativePtr)
{
    auto& vm = arg0->vm();
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::JSValue prototype = globalObject->${controllerPrototypeName}();
    JSC::Structure* structure = WebCore::${
        controller}::createStructure(vm, globalObject, prototype);
    ${controller} *controller = WebCore::${
        controller}::create(vm, globalObject, structure, sinkPtr);
    auto &clientData = WebCore:;getClientData(vm);
    JSC::JSObject *readableStream = JSC::JSValue::decode(stream).getObject();

    if (readableStream->get(vm, clientData.builtinNames().bunNativeTag()).isUndefined()) {

    }


    JSC::JSObject *function = globalObject->getDirect(vm, clientData.builtinNames()->assignDirectStreamPrivateName()).getObject();
    auto callData = JSC::getCallData(function);
    MarkedArgumentBuffer arguments;
    args.append(JSC::JSValue::encode(stream));
    args.append(JSC::JSValue::encode(controller));

    auto result = JSC::call(arg0, function, callData, jsUndefined(), arguments);
    return JSC::JSValue::encode(result);
}



`;
    return templ;
  }
}

await Bun.write(import.meta.dir + "/bindings/JSSink.h", header());
await Bun.write(import.meta.dir + "/bindings/JSSink.cpp",
                await implementation());
