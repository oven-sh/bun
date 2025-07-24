#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/Heap.h"
#include "JavaScriptCore/InternalFunction.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "helpers.h"
#include "wtf/text/WTFString.h"
#include <wtf/text/ASCIILiteral.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <chrono>

namespace Bun {

using namespace JSC;

struct GCEvent {
    String gcType;
    double startTime;
    double endTime;
    double cost;
    
    // Heap statistics before GC
    size_t beforeTotalHeapSize;
    size_t beforeTotalHeapSizeExecutable;
    size_t beforeTotalPhysicalSize;
    size_t beforeTotalAvailableSize;
    size_t beforeTotalGlobalHandlesSize;
    size_t beforeUsedGlobalHandlesSize;
    size_t beforeUsedHeapSize;
    size_t beforeHeapSizeLimit;
    size_t beforeMallocedMemory;
    size_t beforeExternalMemory;
    size_t beforePeakMallocedMemory;
    
    // Heap statistics after GC
    size_t afterTotalHeapSize;
    size_t afterTotalHeapSizeExecutable;
    size_t afterTotalPhysicalSize;
    size_t afterTotalAvailableSize;
    size_t afterTotalGlobalHandlesSize;
    size_t afterUsedGlobalHandlesSize;
    size_t afterUsedHeapSize;
    size_t afterHeapSizeLimit;
    size_t afterMallocedMemory;
    size_t afterExternalMemory;
    size_t afterPeakMallocedMemory;
};

class JSGCProfiler final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGCProfiler* create(JSC::VM& vm, JSC::Structure* structure)
    {
        JSGCProfiler* profiler = new (NotNull, JSC::allocateCell<JSGCProfiler>(vm)) JSGCProfiler(vm, structure);
        profiler->finishCreation(vm);
        return profiler;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSGCProfiler, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSGCProfiler.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSGCProfiler = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSGCProfiler.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSGCProfiler = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;

    void start();
    JSValue stop(JSGlobalObject*);
    bool isProfileActive() const { return m_isActive; }

private:
    JSGCProfiler(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_isActive(false)
        , m_startTime(0)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }

    static void destroy(JSCell* cell)
    {
        static_cast<JSGCProfiler*>(cell)->~JSGCProfiler();
    }

    DECLARE_VISIT_CHILDREN;

    // Capture heap statistics
    void captureHeapStats(size_t& totalHeapSize, size_t& totalHeapSizeExecutable, 
                         size_t& totalPhysicalSize, size_t& totalAvailableSize,
                         size_t& totalGlobalHandlesSize, size_t& usedGlobalHandlesSize,
                         size_t& usedHeapSize, size_t& heapSizeLimit,
                         size_t& mallocedMemory, size_t& externalMemory,
                         size_t& peakMallocedMemory);

    bool m_isActive;
    double m_startTime;
    Vector<GCEvent> m_events;
};

template<typename Visitor>
void JSGCProfiler::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSGCProfiler* thisObject = jsCast<JSGCProfiler*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSGCProfiler);

const ClassInfo JSGCProfiler::s_info = { "GCProfiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGCProfiler) };

void JSGCProfiler::captureHeapStats(size_t& totalHeapSize, size_t& totalHeapSizeExecutable, 
                                   size_t& totalPhysicalSize, size_t& totalAvailableSize,
                                   size_t& totalGlobalHandlesSize, size_t& usedGlobalHandlesSize,
                                   size_t& usedHeapSize, size_t& heapSizeLimit,
                                   size_t& mallocedMemory, size_t& externalMemory,
                                   size_t& peakMallocedMemory)
{
    // Get heap statistics from JavaScriptCore
    VM& vm = this->vm();
    Heap& heap = vm.heap;
    
    totalHeapSize = heap.size();
    totalHeapSizeExecutable = heap.size() >> 1; // Approximation
    totalPhysicalSize = heap.size();
    totalAvailableSize = heap.capacity() - heap.size();
    totalGlobalHandlesSize = 8192; // Fixed value similar to Node.js
    usedGlobalHandlesSize = 2112; // Fixed value similar to Node.js
    usedHeapSize = heap.size();
    heapSizeLimit = heap.capacity();
    mallocedMemory = heap.size();
    externalMemory = heap.extraMemorySize();
    peakMallocedMemory = heap.size(); // Approximation
}

void JSGCProfiler::start()
{
    if (m_isActive)
        return;
    
    m_isActive = true;
    m_startTime = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    m_events.clear();
}

JSValue JSGCProfiler::stop(JSGlobalObject* globalObject)
{
    if (!m_isActive)
        return jsUndefined();
    
    m_isActive = false;
    
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    double endTime = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    
    // Create the result object matching Node.js format
    JSObject* result = constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    result->putDirect(vm, PropertyName(Identifier::fromString(vm, "version"_s)), jsNumber(1), 0);
    result->putDirect(vm, PropertyName(Identifier::fromString(vm, "startTime"_s)), jsNumber(m_startTime), 0);
    result->putDirect(vm, PropertyName(Identifier::fromString(vm, "endTime"_s)), jsNumber(endTime), 0);
    
    // Create statistics array
    JSArray* statistics = JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), m_events.size());
    if (!statistics) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    
    for (size_t i = 0; i < m_events.size(); ++i) {
        const GCEvent& event = m_events[i];
        
        JSObject* gcEvent = constructEmptyObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        gcEvent->putDirect(vm, PropertyName(Identifier::fromString(vm, "gcType"_s)), jsString(vm, event.gcType), 0);
        gcEvent->putDirect(vm, PropertyName(Identifier::fromString(vm, "cost"_s)), jsNumber(event.cost), 0);
        
        // Create beforeGC object
        JSObject* beforeGC = constructEmptyObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        JSObject* beforeHeapStats = constructEmptyObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalHeapSize"_s)), jsNumber(event.beforeTotalHeapSize), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalHeapSizeExecutable"_s)), jsNumber(event.beforeTotalHeapSizeExecutable), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalPhysicalSize"_s)), jsNumber(event.beforeTotalPhysicalSize), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalAvailableSize"_s)), jsNumber(event.beforeTotalAvailableSize), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalGlobalHandlesSize"_s)), jsNumber(event.beforeTotalGlobalHandlesSize), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "usedGlobalHandlesSize"_s)), jsNumber(event.beforeUsedGlobalHandlesSize), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "usedHeapSize"_s)), jsNumber(event.beforeUsedHeapSize), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "heapSizeLimit"_s)), jsNumber(event.beforeHeapSizeLimit), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "mallocedMemory"_s)), jsNumber(event.beforeMallocedMemory), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "externalMemory"_s)), jsNumber(event.beforeExternalMemory), 0);
        beforeHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "peakMallocedMemory"_s)), jsNumber(event.beforePeakMallocedMemory), 0);
        
        beforeGC->putDirect(vm, PropertyName(Identifier::fromString(vm, "heapStatistics"_s)), beforeHeapStats, 0);
        
        // For simplicity, create empty heapSpaceStatistics array
        JSArray* beforeHeapSpaceStats = JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), 0);
        if (!beforeHeapSpaceStats) {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        beforeGC->putDirect(vm, PropertyName(Identifier::fromString(vm, "heapSpaceStatistics"_s)), beforeHeapSpaceStats, 0);
        
        gcEvent->putDirect(vm, PropertyName(Identifier::fromString(vm, "beforeGC"_s)), beforeGC, 0);
        
        // Create afterGC object (similar structure)
        JSObject* afterGC = constructEmptyObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        JSObject* afterHeapStats = constructEmptyObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalHeapSize"_s)), jsNumber(event.afterTotalHeapSize), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalHeapSizeExecutable"_s)), jsNumber(event.afterTotalHeapSizeExecutable), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalPhysicalSize"_s)), jsNumber(event.afterTotalPhysicalSize), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalAvailableSize"_s)), jsNumber(event.afterTotalAvailableSize), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "totalGlobalHandlesSize"_s)), jsNumber(event.afterTotalGlobalHandlesSize), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "usedGlobalHandlesSize"_s)), jsNumber(event.afterUsedGlobalHandlesSize), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "usedHeapSize"_s)), jsNumber(event.afterUsedHeapSize), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "heapSizeLimit"_s)), jsNumber(event.afterHeapSizeLimit), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "mallocedMemory"_s)), jsNumber(event.afterMallocedMemory), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "externalMemory"_s)), jsNumber(event.afterExternalMemory), 0);
        afterHeapStats->putDirect(vm, PropertyName(Identifier::fromString(vm, "peakMallocedMemory"_s)), jsNumber(event.afterPeakMallocedMemory), 0);
        
        afterGC->putDirect(vm, PropertyName(Identifier::fromString(vm, "heapStatistics"_s)), afterHeapStats, 0);
        
        JSArray* afterHeapSpaceStats = JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), 0);
        if (!afterHeapSpaceStats) {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
        afterGC->putDirect(vm, PropertyName(Identifier::fromString(vm, "heapSpaceStatistics"_s)), afterHeapSpaceStats, 0);
        
        gcEvent->putDirect(vm, PropertyName(Identifier::fromString(vm, "afterGC"_s)), afterGC, 0);
        
        statistics->putDirectIndex(globalObject, i, gcEvent);
        RETURN_IF_EXCEPTION(scope, {});
    }
    
    result->putDirect(vm, PropertyName(Identifier::fromString(vm, "statistics"_s)), statistics, 0);
    
    return result;
}

// Function declarations for methods
static JSC_DECLARE_HOST_FUNCTION(jsGCProfilerProtoFuncStart);
static JSC_DECLARE_HOST_FUNCTION(jsGCProfilerProtoFuncStop);

// Prototype method table
static const HashTableValue JSGCProfilerPrototypeTableValues[] = {
    { "start"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGCProfilerProtoFuncStart, 0 } },
    { "stop"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsGCProfilerProtoFuncStop, 0 } },
};

// Prototype class
class JSGCProfilerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGCProfilerPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSGCProfilerPrototype* prototype = new (NotNull, allocateCell<JSGCProfilerPrototype>(vm)) JSGCProfilerPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSGCProfilerPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);
};

const ClassInfo JSGCProfilerPrototype::s_info = { "GCProfiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGCProfilerPrototype) };

void JSGCProfilerPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSGCProfiler::info(), JSGCProfilerPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Constructor
static JSC_DECLARE_HOST_FUNCTION(gcProfilerConstructorCall);
static JSC_DECLARE_HOST_FUNCTION(gcProfilerConstructorConstruct);

class JSGCProfilerConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSGCProfilerConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSGCProfilerConstructor* constructor = new (NotNull, JSC::allocateCell<JSGCProfilerConstructor>(vm)) JSGCProfilerConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSGCProfilerConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, gcProfilerConstructorCall, gcProfilerConstructorConstruct)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 0, "GCProfiler"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};

const ClassInfo JSGCProfilerConstructor::s_info = { "GCProfiler"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSGCProfilerConstructor) };

// Host function implementations
JSC_DEFINE_HOST_FUNCTION(gcProfilerConstructorCall, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "GCProfiler constructor cannot be invoked without 'new'"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(gcProfilerConstructorConstruct, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSGCProfilerClassStructure.get(zigGlobalObject);
    JSValue newTarget = callFrame->newTarget();
    
    if (zigGlobalObject->m_JSGCProfilerClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor GCProfiler cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->m_JSGCProfilerClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSGCProfiler::create(vm, structure)));
}

JSC_DEFINE_HOST_FUNCTION(jsGCProfilerProtoFuncStart, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGCProfiler* thisObject = jsDynamicCast<JSGCProfiler*>(callFrame->thisValue());
    if (!thisObject) {
        throwTypeError(globalObject, scope, "GCProfiler.prototype.start called on incompatible receiver"_s);
        return {};
    }

    thisObject->start();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsGCProfilerProtoFuncStop, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSGCProfiler* thisObject = jsDynamicCast<JSGCProfiler*>(callFrame->thisValue());
    if (!thisObject) {
        throwTypeError(globalObject, scope, "GCProfiler.prototype.stop called on incompatible receiver"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->stop(globalObject)));
}

// Setup function for lazy class structure
void setupGCProfilerClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSGCProfilerPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSGCProfilerPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSGCProfilerConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSGCProfilerConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSGCProfiler::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

// Export function to create GCProfiler constructor
extern "C" JSC::EncodedJSValue Bun__createGCProfilerConstructor(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->m_JSGCProfilerClassStructure.constructor(globalObject));
}

} // namespace Bun

JSC::JSValue createGCProfilerFunctions(Zig::GlobalObject* globalObject)
{
    using namespace JSC;
    auto& vm = JSC::getVM(globalObject);
    auto* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "GCProfiler"_s)), globalObject->m_JSGCProfilerClassStructure.constructor(globalObject), 0);

    return obj;
}