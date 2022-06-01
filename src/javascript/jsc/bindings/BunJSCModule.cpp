#include "root.h"
#include "JavaScriptCore/JSCInlines.h"

#include "JavaScriptCore/JavaScript.h"
#include "wtf/MemoryFootprint.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/JSCInlines.h"
#include "JavaScriptCore/TestRunnerUtils.h"
#include "JavaScriptCore/JIT.h"
#include "JavaScriptCore/APICast.h"
#include "JavaScriptCore/JSBasePrivate.h"
#include "JavaScriptCore/ObjectConstructor.h"

#include "mimalloc.h"

using namespace JSC;
using namespace WTF;

JSC_DECLARE_HOST_FUNCTION(functionDescribe);
JSC_DEFINE_HOST_FUNCTION(functionDescribe, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsString(vm, toString(callFrame->argument(0))));
}

JSC_DECLARE_HOST_FUNCTION(functionDescribeArray);
JSC_DEFINE_HOST_FUNCTION(functionDescribeArray, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsUndefined());
    VM& vm = globalObject->vm();
    JSObject* object = jsDynamicCast<JSObject*>(callFrame->argument(0));
    if (!object)
        return JSValue::encode(jsNontrivialString(vm, "<not object>"_s));
    return JSValue::encode(jsNontrivialString(vm, toString("<Butterfly: ", RawPointer(object->butterfly()), "; public length: ", object->getArrayLength(), "; vector length: ", object->getVectorLength(), ">")));
}

JSC_DECLARE_HOST_FUNCTION(functionGCAndSweep);
JSC_DEFINE_HOST_FUNCTION(functionGCAndSweep, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    vm.heap.collectNow(Sync, CollectionScope::Full);
    return JSValue::encode(jsNumber(vm.heap.sizeAfterLastFullCollection()));
}

JSC_DECLARE_HOST_FUNCTION(functionFullGC);
JSC_DEFINE_HOST_FUNCTION(functionFullGC, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    vm.heap.collectSync(CollectionScope::Full);
    return JSValue::encode(jsNumber(vm.heap.sizeAfterLastFullCollection()));
}

JSC_DECLARE_HOST_FUNCTION(functionEdenGC);
JSC_DEFINE_HOST_FUNCTION(functionEdenGC, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    vm.heap.collectSync(CollectionScope::Eden);
    return JSValue::encode(jsNumber(vm.heap.sizeAfterLastEdenCollection()));
}

JSC_DECLARE_HOST_FUNCTION(functionHeapSize);
JSC_DEFINE_HOST_FUNCTION(functionHeapSize, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    return JSValue::encode(jsNumber(vm.heap.size()));
}

class JSCMemoryFootprint : public JSDestructibleObject {
    using Base = JSDestructibleObject;

public:
    template<typename CellType, SubspaceAccess>
    static CompleteSubspace* subspaceFor(VM& vm)
    {
        return &vm.destructibleObjectSpace();
    }

    JSCMemoryFootprint(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }

    static JSCMemoryFootprint* create(VM& vm, JSGlobalObject* globalObject)
    {
        Structure* structure = createStructure(vm, globalObject, jsNull());
        JSCMemoryFootprint* footprint = new (NotNull, allocateCell<JSCMemoryFootprint>(vm)) JSCMemoryFootprint(vm, structure);
        footprint->finishCreation(vm);
        return footprint;
    }

    void finishCreation(VM& vm)
    {
        Base::finishCreation(vm);

        auto addProperty = [&](VM& vm, ASCIILiteral name, JSValue value) {
            JSCMemoryFootprint::addProperty(vm, name, value);
        };

        size_t elapsed_msecs = 0;
        size_t user_msecs = 0;
        size_t system_msecs = 0;
        size_t current_rss = 0;
        size_t peak_rss = 0;
        size_t current_commit = 0;
        size_t peak_commit = 0;
        size_t page_faults = 0;

        mi_process_info(&elapsed_msecs, &user_msecs, &system_msecs,
            &current_rss, &peak_rss,
            &current_commit, &peak_commit, &page_faults);

        addProperty(vm, "current"_s, jsNumber(current_rss));
        addProperty(vm, "peak"_s, jsNumber(peak_rss));
        addProperty(vm, "currentCommit"_s, jsNumber(current_commit));
        addProperty(vm, "peakCommit"_s, jsNumber(peak_commit));
        addProperty(vm, "pageFaults"_s, jsNumber(page_faults));
    }

    DECLARE_INFO;

private:
    void addProperty(VM& vm, ASCIILiteral name, JSValue value)
    {
        Identifier identifier = Identifier::fromString(vm, name);
        putDirect(vm, identifier, value);
    }
};

const ClassInfo JSCMemoryFootprint::s_info = { "MemoryFootprint"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCMemoryFootprint) };

JSC_DECLARE_HOST_FUNCTION(functionMemoryUsageStatistics);
JSC_DEFINE_HOST_FUNCTION(functionMemoryUsageStatistics, (JSGlobalObject * globalObject, CallFrame*))
{
    auto contextRef = toRef(globalObject);
    return JSValue::encode(toJS(JSGetMemoryUsageStatistics(contextRef)));
}

JSC_DECLARE_HOST_FUNCTION(functionCreateMemoryFootprint);
JSC_DEFINE_HOST_FUNCTION(functionCreateMemoryFootprint, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    return JSValue::encode(JSCMemoryFootprint::create(vm, globalObject));
}

JSC_DECLARE_HOST_FUNCTION(functionGetRandomSeed);
JSC_DEFINE_HOST_FUNCTION(functionGetRandomSeed, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(jsNumber(globalObject->weakRandom().seed()));
}

JSC_DECLARE_HOST_FUNCTION(functionSetRandomSeed);
JSC_DEFINE_HOST_FUNCTION(functionSetRandomSeed, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    unsigned seed = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    globalObject->weakRandom().setSeed(seed);
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(functionIsRope);
JSC_DEFINE_HOST_FUNCTION(functionIsRope, (JSGlobalObject*, CallFrame* callFrame))
{
    JSValue argument = callFrame->argument(0);
    if (!argument.isString())
        return JSValue::encode(jsBoolean(false));
    const StringImpl* impl = asString(argument)->tryGetValueImpl();
    return JSValue::encode(jsBoolean(!impl));
}

JSC_DECLARE_HOST_FUNCTION(functionCallerSourceOrigin);
JSC_DEFINE_HOST_FUNCTION(functionCallerSourceOrigin, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    if (sourceOrigin.url().isNull())
        return JSValue::encode(jsNull());
    return JSValue::encode(jsString(vm, sourceOrigin.string()));
}

JSC_DECLARE_HOST_FUNCTION(functionNoFTL);
JSC_DEFINE_HOST_FUNCTION(functionNoFTL, (JSGlobalObject*, CallFrame* callFrame))
{
    if (callFrame->argumentCount()) {
        FunctionExecutable* executable = getExecutableForFunction(callFrame->argument(0));
        if (executable)
            executable->setNeverFTLOptimize(true);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(functionNoOSRExitFuzzing);
JSC_DEFINE_HOST_FUNCTION(functionNoOSRExitFuzzing, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(setCannotUseOSRExitFuzzing(globalObject, callFrame));
}

JSC_DECLARE_HOST_FUNCTION(functionOptimizeNextInvocation);
JSC_DEFINE_HOST_FUNCTION(functionOptimizeNextInvocation, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(optimizeNextInvocation(globalObject, callFrame));
}

JSC_DECLARE_HOST_FUNCTION(functionNumberOfDFGCompiles);
JSC_DEFINE_HOST_FUNCTION(functionNumberOfDFGCompiles, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(numberOfDFGCompiles(globalObject, callFrame));
}

JSC_DECLARE_HOST_FUNCTION(functionReleaseWeakRefs);
JSC_DEFINE_HOST_FUNCTION(functionReleaseWeakRefs, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    globalObject->vm().finalizeSynchronousJSExecution();
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(functionTotalCompileTime);
JSC_DEFINE_HOST_FUNCTION(functionTotalCompileTime, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsNumber(JIT::totalCompileTime().milliseconds()));
}

JSC_DECLARE_HOST_FUNCTION(functionReoptimizationRetryCount);
JSC_DEFINE_HOST_FUNCTION(functionReoptimizationRetryCount, (JSGlobalObject*, CallFrame* callFrame))
{
    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsUndefined());

    CodeBlock* block = getSomeBaselineCodeBlockForFunction(callFrame->argument(0));
    if (!block)
        return JSValue::encode(jsNumber(0));

    return JSValue::encode(jsNumber(block->reoptimizationRetryCounter()));
}

extern "C" void Bun__drainMicrotasks();

JSC_DECLARE_HOST_FUNCTION(functionDrainMicrotasks);
JSC_DEFINE_HOST_FUNCTION(functionDrainMicrotasks, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    vm.drainMicrotasks();
    Bun__drainMicrotasks();
    return JSValue::encode(jsUndefined());
}

JSC::JSObject* createJSCModule(JSC::JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSC::JSObject* object = nullptr;

    {
        JSC::ObjectInitializationScope initializationScope(vm);
        object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 20);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "describe"_s), 1, functionDescribe, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "describeArray"_s), 1, functionDescribeArray, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "gcAndSweep"_s), 1, functionGCAndSweep, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "fullGC"_s), 1, functionFullGC, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "edenGC"_s), 1, functionEdenGC, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "heapSize"_s), 1, functionHeapSize, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "heapStats"_s), 1, functionMemoryUsageStatistics, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "memoryUsage"_s), 1, functionCreateMemoryFootprint, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "getRandomSeed"_s), 1, functionGetRandomSeed, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "setRandomSeed"_s), 1, functionSetRandomSeed, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "isRope"_s), 1, functionIsRope, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "callerSourceOrigin"_s), 1, functionCallerSourceOrigin, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "noFTL"_s), 1, functionNoFTL, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "noOSRExitFuzzing"_s), 1, functionNoOSRExitFuzzing, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "optimizeNextInvocation"_s), 1, functionOptimizeNextInvocation, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "numberOfDFGCompiles"_s), 1, functionNumberOfDFGCompiles, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "releaseWeakRefs"_s), 1, functionReleaseWeakRefs, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "totalCompileTime"_s), 1, functionTotalCompileTime, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "reoptimizationRetryCount"_s), 1, functionReoptimizationRetryCount, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
        object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "drainMicrotasks"_s), 1, functionDrainMicrotasks, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
    }

    return object;
}