#include "config.h"
#include "JSProfiler.h"

#include "ActiveDOMObject.h"
#include "EventNames.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "IDLTypes.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertDictionary.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertPromise.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperation.h"
#include "JSDOMPromiseDeferred.h"
#include "JSDOMWrapperCache.h"
#include "JSEventTarget.h"
#include "JSProfilerTrace.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <wtf/GetPtr.h>
#include <wtf/PointerPreparations.h>
#include <wtf/URL.h>

namespace WebCore {
using namespace JSC;

// Functions
static JSC_DECLARE_HOST_FUNCTION(jsProfilerPrototypeFunction_stop);

// Attributes
static JSC_DECLARE_CUSTOM_GETTER(jsProfilerConstructor);
static JSC_DECLARE_CUSTOM_GETTER(jsProfiler_sampleInterval);
static JSC_DECLARE_CUSTOM_GETTER(jsProfiler_stopped);

// Prototype class
class JSProfilerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSProfilerPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSProfilerPrototype* ptr = new (NotNull, JSC::allocateCell<JSProfilerPrototype>(vm)) JSProfilerPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSProfilerPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSProfilerPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSProfilerPrototype, JSProfilerPrototype::Base);

using JSProfilerDOMConstructor = JSDOMConstructor<JSProfiler>;

// Constructor implementation
static inline JSC::EncodedJSValue constructJSProfiler(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = jsCast<JSProfilerDOMConstructor*>(callFrame->jsCallee());
    ASSERT(castedThis);

    if (!callFrame->argumentCount())
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));

    auto* context = castedThis->scriptExecutionContext();
    if (!context) [[unlikely]]
        return throwConstructorScriptExecutionContextUnavailableError(*lexicalGlobalObject, throwScope, "Profiler"_s);

    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto options = convert<IDLDictionary<ProfilerInitOptions>>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, {});

    auto object = Profiler::create(*context, WTFMove(options));
    if constexpr (IsExceptionOr<decltype(object)>)
        RETURN_IF_EXCEPTION(throwScope, {});
    static_assert(TypeOrExceptionOrUnderlyingType<decltype(object)>::isRef);

    auto jsValue = toJSNewlyCreated<IDLInterface<Profiler>>(*lexicalGlobalObject, *castedThis->globalObject(), throwScope, WTFMove(object));
    if constexpr (IsExceptionOr<decltype(object)>)
        RETURN_IF_EXCEPTION(throwScope, {});

    setSubclassStructureIfNeeded<Profiler>(lexicalGlobalObject, callFrame, asObject(jsValue));
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(jsValue);
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSProfilerDOMConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    size_t argsCount = std::min<size_t>(1, callFrame->argumentCount());
    if (argsCount == 1)
        return constructJSProfiler(lexicalGlobalObject, callFrame);
    return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
}
JSC_ANNOTATE_HOST_FUNCTION(JSProfilerConstructorConstruct, JSProfilerDOMConstructor::construct);

template<> const ClassInfo JSProfilerDOMConstructor::s_info = { "Profiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSProfilerDOMConstructor) };

template<> JSValue JSProfilerDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return JSEventTarget::getConstructor(vm, &globalObject);
}

template<> void JSProfilerDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "Profiler"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSProfiler::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

/* Hash table for prototype */
static const HashTableValue JSProfilerPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsProfilerConstructor, 0 } },
    { "sampleInterval"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsProfiler_sampleInterval, 0 } },
    { "stopped"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsProfiler_stopped, 0 } },
    { "stop"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsProfilerPrototypeFunction_stop, 0 } },
};

const ClassInfo JSProfilerPrototype::s_info = { "Profiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSProfilerPrototype) };

void JSProfilerPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSProfiler::info(), JSProfilerPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSProfiler::s_info = { "Profiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSProfiler) };

JSProfiler::JSProfiler(Structure* structure, JSDOMGlobalObject& globalObject, Ref<Profiler>&& impl)
    : JSEventTarget(structure, globalObject, WTFMove(impl))
{
}

void JSProfiler::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSObject* JSProfiler::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSProfilerPrototype::create(vm, &globalObject, JSProfilerPrototype::createStructure(vm, &globalObject, JSEventTarget::prototype(vm, globalObject)));
}

JSObject* JSProfiler::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSProfiler>(vm, globalObject);
}

JSValue JSProfiler::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSProfilerDOMConstructor, DOMConstructorID::Profiler>(vm, *jsCast<const JSDOMGlobalObject*>(globalObject));
}

Profiler* JSProfiler::toWrapped(VM& vm, JSValue value)
{
    if (auto* wrapper = jsDynamicCast<JSProfiler*>(value))
        return &wrapper->wrapped();
    return nullptr;
}

// Attribute getters
JSC_DEFINE_CUSTOM_GETTER(jsProfilerConstructor, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = jsDynamicCast<JSProfilerPrototype*>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSProfiler::getConstructor(vm, prototype->globalObject()));
}

static inline JSValue jsProfiler_sampleIntervalGetter(JSGlobalObject& lexicalGlobalObject, JSProfiler& thisObject)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject.wrapped();
    RELEASE_AND_RETURN(throwScope, (toJS<IDLDouble>(lexicalGlobalObject, throwScope, impl.sampleInterval())));
}

JSC_DEFINE_CUSTOM_GETTER(jsProfiler_sampleInterval, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<JSProfiler>::get<jsProfiler_sampleIntervalGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsProfiler_stoppedGetter(JSGlobalObject& lexicalGlobalObject, JSProfiler& thisObject)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject.wrapped();
    RELEASE_AND_RETURN(throwScope, (toJS<IDLBoolean>(lexicalGlobalObject, throwScope, impl.stopped())));
}

JSC_DEFINE_CUSTOM_GETTER(jsProfiler_stopped, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<JSProfiler>::get<jsProfiler_stoppedGetter>(*lexicalGlobalObject, thisValue, attributeName);
}

// stop() method
JSC_DEFINE_HOST_FUNCTION(jsProfilerPrototypeFunction_stop, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    auto* castedThis = jsDynamicCast<JSProfiler*>(thisValue);
    if (!castedThis) [[unlikely]]
        return throwThisTypeError(*lexicalGlobalObject, throwScope, "Profiler"_s, "stop"_s);

    ASSERT_GC_OBJECT_INHERITS(castedThis, JSProfiler::info());
    auto& impl = castedThis->wrapped();

    return JSValue::encode(callPromiseFunction(
        *lexicalGlobalObject,
        *callFrame,
        [&impl](JSC::JSGlobalObject&, JSC::CallFrame&, Ref<DeferredPromise>&& promise) {
            impl.stop(WTFMove(promise));
        }
    ));
}

// toJS functions
JSValue toJS(JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Profiler& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

JSValue toJSNewlyCreated(JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Profiler>&& impl)
{
    return createWrapper<Profiler>(globalObject, WTFMove(impl));
}

// JSProfiler doesn't have additional members to visit beyond JSEventTarget

} // namespace WebCore