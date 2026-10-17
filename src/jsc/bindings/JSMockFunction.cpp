#include "root.h"

#include "ErrorCode+List.h"
#include "JavaScriptCore/Error.h"
#include "JSMockFunction.h"
#include <JavaScriptCore/JSPromise.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "BunClientData.h"
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSPromiseConstructor.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/WeakMapImpl.h>
#include <JavaScriptCore/WeakMapImplInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/ArrayConstructor.h>
#include <JavaScriptCore/ObjectPrototypeInlines.h>
#include <JavaScriptCore/RegExpPrototype.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/ButterflyInlines.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include "BunPlugin.h"
#include "NodeVM.h"
#include "AsyncContextFrame.h"
#include "ErrorCode.h"
#include "headers.h"

BUN_DECLARE_HOST_FUNCTION(JSMock__jsNow);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsSetSystemTime);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsRestoreAllMocks);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsClearAllMocks);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsResetAllMocks);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsSpyOn);
BUN_DECLARE_HOST_FUNCTION(JSMock__jsMockFn);
extern "C" bool JSMock__isInPreload(Zig::GlobalObject*);

#define CHECK_IS_MOCK_FUNCTION(thisValue)                                \
    if (!thisObject) [[unlikely]] {                                      \
        throwInvalidThisError(globalObject, scope, thisValue, "Mock"_s); \
        return {};                                                       \
    }

namespace Bun {

/**
 * intended to be used in an if statement as an abstraction over this double if statement
 *
 * if(jsValue) {
 *   if(auto value = jsDynamicCast(jsValue)) {
 *     ...
 *   }
 * }
 *
 * the reason this is needed is because jsDynamicCast will segfault if given a zero JSValue
 */
template<typename To>
inline To tryJSDynamicCast(JSValue from)
{
    if (!from) [[unlikely]]
        return nullptr;
    if (!from.isCell()) [[unlikely]]
        return nullptr;
    return dynamicDowncast<std::remove_pointer_t<To>>(from.asCell());
}

/**
 * intended to be used in an if statement as an abstraction over this double if statement
 *
 * if(jsValue) {
 *   if(auto value = jsDynamicCast(jsValue)) {
 *     ...
 *   }
 * }
 *
 * the reason this is needed is because jsDynamicCast will segfault if given a zero JSValue
 */
template<typename To, typename WriteBarrierT>
inline To tryJSDynamicCast(const JSC::WriteBarrier<WriteBarrierT>& from)
{
    if (!from) [[unlikely]]
        return nullptr;

    return dynamicDowncast<std::remove_pointer_t<To>>(from.get());
}

JSC_DECLARE_HOST_FUNCTION(jsMockFunctionCall);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionConstruct);
JSC_DECLARE_CUSTOM_GETTER(jsMockFunctionGetter_protoImpl);
JSC_DECLARE_CUSTOM_GETTER(jsMockFunctionGetter_mock);
JSC_DECLARE_CUSTOM_GETTER(jsMockFunctionGetter_prototype);
JSC_DECLARE_CUSTOM_SETTER(jsMockFunctionSetter_prototype);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionGetter_mockGetLastCall);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionGetter_mockGetSettledResults);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionGetMockImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionGetMockName);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockClear);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReset);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockRestore);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockImplementationOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockName);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReturnThis);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReturnValue);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockReturnValueOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockResolvedValue);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockResolvedValueOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockRejectedValue);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockRejectedValueOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockThrow);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionMockThrowOnce);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionWithImplementationCleanup);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionWithImplementation);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionReturnThis);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionRejectWithThis);
JSC_DECLARE_HOST_FUNCTION(jsMockFunctionThrowThis);

uint64_t JSMockModule::s_nextInvocationId = 0;

// This is taken from JSWeakSet
// We only want to hold onto the list of active spies which haven't already been collected
// So we use a WeakSet
// Unlike using WeakSet from JS, we are able to iterate through the WeakSet.
class ActiveSpySet final : public WeakMapImpl<WeakMapBucket<WeakMapBucketDataKey>> {
public:
    using Base = WeakMapImpl<WeakMapBucket<WeakMapBucketDataKey>>;

    DECLARE_EXPORT_INFO;

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSWeakSetType, StructureFlags), info());
    }

    static ActiveSpySet* create(VM& vm, Structure* structure)
    {
        ActiveSpySet* instance = new (NotNull, allocateCell<ActiveSpySet>(vm)) ActiveSpySet(vm, structure);
        instance->finishCreation(vm);
        return instance;
    }

private:
    ActiveSpySet(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};

static_assert(std::is_final<ActiveSpySet>::value, "Required for JSType based casting");
const ClassInfo ActiveSpySet::s_info = { "ActiveSpySet"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ActiveSpySet) };

class JSMockImplementation final : public JSNonFinalObject {
public:
    enum class Kind : uint8_t {
        Call,
        ReturnValue,
        ReturnThis,
        RejectedValue,
        ThrowValue,
        // mockImplementation() without a function. Calls return undefined, and so does getMockImplementation().
        Nothing,
    };

    static JSMockImplementation* create(JSC::JSGlobalObject* globalObject, JSC::Structure* structure, Kind kind, JSC::JSValue heldValue, bool isOnce)
    {
        auto& vm = JSC::getVM(globalObject);
        JSMockImplementation* impl = new (NotNull, allocateCell<JSMockImplementation>(vm)) JSMockImplementation(vm, structure, kind, heldValue, isOnce ? jsNumber(1) : jsUndefined());
        impl->finishCreation(vm);
        return impl;
    }

    using Base = JSC::JSNonFinalObject;
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSMockImplementation, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSMockImplementation, m_subspaceForJSMockImplementation));
    }

    // either a function or a return value, depends on kind
    mutable JSC::WriteBarrier<JSC::Unknown> underlyingValue;

    // a combination of a pointer to the next implementation and a flag indicating if this is a once implementation
    // - undefined            - no next value
    // - jsNumber(1)          - no next value + is a once implementation
    // - JSMockImplementation - next value + is a once implementation
    mutable JSC::WriteBarrier<JSC::Unknown> nextValueOrSentinel;

    // For a kind other than Call: the function it's shorthand for, once getMockImplementation() has asked for it.
    mutable JSC::WriteBarrier<JSC::JSObject> function;

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    Kind kind { Kind::ReturnValue };

    bool isOnce()
    {
        return !nextValueOrSentinel.get().isUndefined();
    }

    JSMockImplementation(JSC::VM& vm, JSC::Structure* structure, Kind kind, JSC::JSValue first, JSC::JSValue second)
        : Base(vm, structure)
        , underlyingValue(first, JSC::WriteBarrierEarlyInit)
        , nextValueOrSentinel(second, JSC::WriteBarrierEarlyInit)
        , kind(kind)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }
};

template<typename Visitor>
void JSMockImplementation::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSMockImplementation* fn = uncheckedDowncast<JSMockImplementation>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->underlyingValue);
    visitor.append(fn->nextValueOrSentinel);
    visitor.append(fn->function);
}

DEFINE_VISIT_CHILDREN(JSMockImplementation);

const ClassInfo JSMockImplementation::s_info = { "MockImpl"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMockImplementation) };

// Returns a data property's value, an accessor's raw GetterSetter / CustomGetterSetter cell, or empty if there's no own property.
static JSValue getOwnPropertyStorage(JSGlobalObject* globalObject, JSObject* object, PropertyName key, unsigned& attributes)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty);
    bool found = object->methodTable()->getOwnPropertySlot(object, globalObject, key, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (!found)
        return {};

    attributes = slot.attributes();
    if (slot.isAccessor())
        return slot.getterSetter();
    if (slot.isValue())
        RELEASE_AND_RETURN(scope, slot.getValue(globalObject, key));

    JSValue custom = object->getDirect(vm, key, attributes);
    if (!custom && !object->staticPropertiesReified()) {
        object->reifyAllStaticProperties(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        custom = object->getDirect(vm, key, attributes);
    }
    return custom;
}

JSObject* processEnvOfImportMetaEnvForTests(JSGlobalObject*, JSObject*);

// Script never sees what putDirect() stores on a Proxy, or on a node:vm global for a key that the contextified object has.
static bool isOpaqueProperty(JSGlobalObject* globalObject, JSObject* object, PropertyName key)
{
    if (!object->structure()->typeInfo().prohibitsPropertyCaching()) [[likely]]
        return false;
    if (auto* contextGlobal = dynamicDowncast<NodeVMGlobalObject>(object)) {
        JSObject* contextified = contextGlobal->contextifiedObject();
        return contextified && contextified->hasOwnProperty(globalObject, key);
    }
    return object->type() == ProxyObjectType;
}

static void putOwnPropertyStorage(JSGlobalObject* globalObject, JSObject* object, PropertyName key, JSValue storage, unsigned attributes, bool isOpaque)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (isOpaque) {
        PropertyDescriptor descriptor;
        if (attributes & PropertyAttribute::Accessor)
            descriptor.setAccessorDescriptor(uncheckedDowncast<GetterSetter>(storage), attributes);
        else
            descriptor.setDescriptor(storage, attributes);
        scope.release();
        object->methodTable()->defineOwnProperty(object, globalObject, key, descriptor, true);
    } else if (attributes & PropertyAttribute::Accessor) {
        scope.release();
        object->putDirectAccessor(globalObject, key, uncheckedDowncast<GetterSetter>(storage), attributes);
    } else if (attributes & PropertyAttribute::CustomAccessorOrValue) {
        // putDirectCustomAccessor() asserts that the property is new.
        {
            VM::DeletePropertyModeScope deleteNonConfigurable(vm, VM::DeletePropertyMode::IgnoreConfigurable);
            JSCell::deleteProperty(object, globalObject, key);
        }
        RETURN_IF_EXCEPTION(scope, );
        object->putDirectCustomAccessor(vm, key, storage, attributes);
    } else if (auto index = parseIndex(key)) {
        scope.release();
        object->putDirectIndex(globalObject, *index, storage, attributes, PutDirectIndexLikePutDirect);
    } else {
        object->putDirect(vm, key, storage, attributes);
    }
}

static constexpr unsigned descriptorAttributes = PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::Accessor;

static void putOwnProperty(JSGlobalObject* globalObject, JSObject* object, PropertyName key, const PropertyDescriptor& descriptor)
{
    JSValue storage = descriptor.isAccessorDescriptor() ? GetterSetter::create(globalObject->vm(), globalObject, descriptor.getter(), descriptor.setter()) : descriptor.value();
    putOwnPropertyStorage(globalObject, object, key, storage, descriptor.attributes() & descriptorAttributes, false);
}

class JSMockFunction final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static constexpr unsigned prototypeAttributes = JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete;
    static constexpr JSC::PropertyOffset prototypeOffset = JSC::firstOutOfLineOffset;

    static JSMockFunction* create(JSC::VM& vm, Zig::GlobalObject* globalObject)
    {
        JSC::Structure* structure = globalObject->mockModule.mockFunctionStructure.getInitializedOnMainThread(globalObject);
        JSC::JSCell* lazyPrototype = globalObject->mockModule.lazyPrototype.getInitializedOnMainThread(globalObject);
        JSC::Butterfly* butterfly = JSC::Butterfly::create(vm, nullptr, 0, structure->outOfLineCapacity(), false, JSC::IndexingHeader(), 0);
        JSMockFunction* function = new (NotNull, JSC::allocateCell<JSMockFunction>(vm)) JSMockFunction(vm, structure);
        function->setButterfly(vm, butterfly);
        function->putDirectOffset(vm, prototypeOffset, lazyPrototype);
        function->finishCreation(vm);

        // Do not forget to set the original name: https://github.com/oven-sh/bun/issues/8794
        function->m_originalName.set(vm, function, Bun::commonStrings(vm).mockedFunctionString());

        return function;
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        Structure* structure = Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(InternalFunctionType, StructureFlags), info());
        JSC::PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, vm.propertyNames->prototype, prototypeAttributes | JSC::PropertyAttribute::CustomValue, offset);
        RELEASE_ASSERT(offset == prototypeOffset);
        structure->setHasAnyKindOfGetterSetterPropertiesWithProtoCheck(false);
        return structure;
    }

    DECLARE_INFO;

    DECLARE_VISIT_CHILDREN;
    template<typename Visitor> void visitAdditionalChildrenInGCThread(Visitor&);
    DECLARE_VISIT_OUTPUT_CONSTRAINTS;

    struct Recorded {
        JSC::WriteBarrier<JSC::JSArray> calls;
        JSC::WriteBarrier<JSC::JSArray> contexts;
        JSC::WriteBarrier<JSC::JSArray> invocationCallOrder;
        // Would duplicate `contexts`, so it's only built once `new` or script needs it (materializeInstances).
        JSC::WriteBarrier<JSC::JSArray> instances;
        JSC::WriteBarrier<JSC::JSArray> returnValues;
        JSC::WriteBarrier<JSC::JSObject> state;
    };

    struct Configuration {
        // three pointers to implementation objects
        // head of the list, this one is run next
        JSC::WriteBarrier<JSC::Unknown> implementation;
        // this contains the non-once implementation. there is only ever one of these
        JSC::WriteBarrier<JSC::Unknown> fallbackImplmentation;
        // the last once implementation
        JSC::WriteBarrier<JSC::Unknown> tail;
        JSC::WriteBarrier<JSC::JSString> mockName;
    };

    const Recorded& recorded() const { return m_recorded; }
    const Configuration& configuration() const { return m_configuration; }

    // Every write goes through these, which register the mock so that clearAllMocks() / resetAllMocks() can find it.
    Recorded& willRecord()
    {
        enter(List::Called);
        return m_recorded;
    }
    Configuration& willConfigure()
    {
        enter(List::Configured);
        return m_configuration;
    }

    // Set on an automocked class instance's method mock: the mock of the same method on the class prototype.
    JSC::WriteBarrier<JSMockFunction> prototypeMock;
    bool isAutomock { false };
    bool isVitest { false };
    // Made through `jest`. With neither flag it comes from bun:test's mock() or spyOn(), and its mock name is its `name`.
    bool isJest { false };
    bool isSpy { false };
    // `prototype` is still the CustomValue shared by all mocks, which creates the object on first read.
    bool hasLazyPrototype { true };
    // Preloads and their beforeAll() hooks run once for all test files, so the end of a test file leaves it alone.
    bool isMadeByPreload { false };

    static constexpr unsigned SpyAttributeESModuleNamespace = 1 << 30;
    // The spy is the property's getter or setter, or what its getter returns.
    static constexpr unsigned SpyAttributeAccessor = 1 << 29;
    // isOpaqueProperty() was true at install time, so restore the same way.
    static constexpr unsigned SpyAttributeOpaque = 1 << 28;

    JSString* jsName()
    {
        return m_originalName.get();
    }

    void setName(JSString* name)
    {
        auto& vm = this->vm();

        // Do not forget to set the original name: https://github.com/oven-sh/bun/issues/8794
        m_originalName.set(vm, this, name);

        this->putDirect(vm, vm.propertyNames->name, name, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
    }

    void setName(const WTF::String& name)
    {
        setName(jsString(this->vm(), name));
    }

    JSMockModule& mockModule() const
    {
        return uncheckedDowncast<Zig::GlobalObject>(globalObject())->mockModule;
    }

    void copyLength(JSC::VM& vm, JSGlobalObject* global, JSC::JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto* fn = dynamicDowncast<JSFunction>(value);
        if (!fn)
            return;
        JSValue length = fn->get(global, vm.propertyNames->length);
        RETURN_IF_EXCEPTION(scope, );
        if (length.isNumber())
            this->putDirect(vm, vm.propertyNames->length, length, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
    }

    void copyNameAndLength(JSC::VM& vm, JSGlobalObject* global, JSC::JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(vm);
        WTF::String nameToUse;
        if (auto* fn = dynamicDowncast<JSFunction>(value)) {
            nameToUse = fn->name(vm);
            // `const f = () => {}` and `{ f: () => {} }` only have an ecmaName().
            if (nameToUse.isEmpty() && !fn->isHostFunction())
                nameToUse = fn->jsExecutable()->ecmaName().string();
            // `{ [symbol]() {} }` only has the `name` property.
            if (nameToUse.isEmpty()) {
                JSValue nameValue = fn->get(global, vm.propertyNames->name);
                RETURN_IF_EXCEPTION(scope, );
                if (nameValue.isString()) {
                    nameToUse = asString(nameValue)->value(global);
                    RETURN_IF_EXCEPTION(scope, );
                }
            }
            JSValue lengthJSValue = fn->get(global, vm.propertyNames->length);
            RETURN_IF_EXCEPTION(scope, );
            if (lengthJSValue.isNumber()) {
                this->putDirect(vm, vm.propertyNames->length, (lengthJSValue), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
            }
        } else if (auto* fn = dynamicDowncast<JSMockFunction>(value)) {
            JSValue nameValue = fn->get(global, vm.propertyNames->name);
            RETURN_IF_EXCEPTION(scope, );
            nameToUse = nameValue.toWTFString(global);
            RETURN_IF_EXCEPTION(scope, );
        } else if (auto* fn = dynamicDowncast<InternalFunction>(value)) {
            nameToUse = fn->name();
        } else {
            nameToUse = "mockConstructor"_s;
        }
        this->setName(nameToUse);
    }

    static bool isOwnPropertyOfEveryFunction(JSC::VM& vm, UniquedStringImpl* key)
    {
        return key == vm.propertyNames->length.impl() || key == vm.propertyNames->name.impl() || key == vm.propertyNames->prototype.impl();
    }

    // A plain JSFunction's structure lists all its own keys except the lazily reified length, name and prototype.
    static bool isOrdinaryFunction(JSObject* function)
    {
        return function->type() == JSC::JSFunctionType && !JSC::hasIndexedProperties(function->indexingType()) && !function->structure()->typeInfo().hasStaticPropertyTable();
    }

    static bool hasNoStaticProperties(JSC::VM& vm, JSObject* function)
    {
        if (!isOrdinaryFunction(function))
            return false;
        bool hasNone = true;
        function->structure()->forEachProperty(vm, [&](const auto& entry) {
            hasNone = isOwnPropertyOfEveryFunction(vm, entry.key());
            return hasNone;
        });
        return hasNone;
    }

    void copyStaticProperties(JSGlobalObject* globalObject, JSObject* function)
    {
        auto& vm = this->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        JSObject* holder = function;
        while (hasNoStaticProperties(vm, holder)) {
            JSValue next = holder->getPrototypeDirect();
            if (!next.isObject())
                return;
            holder = asObject(next);
        }
        if (holder == globalObject->functionPrototype())
            return;

        PropertyNameArrayBuilder keys(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
        while (holder != globalObject->functionPrototype() && holder != globalObject->objectPrototype()) {
            size_t firstKey = keys.size();
            if (isOrdinaryFunction(holder)) {
                holder->structure()->forEachProperty(vm, [&](const auto& entry) {
                    keys.add(entry.key());
                    return true;
                });
            } else {
                holder->methodTable()->getOwnPropertyNames(holder, globalObject, keys, DontEnumPropertiesMode::Include);
                RETURN_IF_EXCEPTION(scope, );
            }

            for (size_t i = firstKey; i < keys.size(); ++i) {
                Identifier key = keys[i];
                if (isOwnPropertyOfEveryFunction(vm, key.impl()))
                    continue;
                // Copying it would make promisify(mock) bypass the mock.
                if (key.isSymbol() && key.impl() == vm.symbolRegistry().symbolForKey("nodejs.util.promisify.custom"_s).ptr())
                    continue;
                bool exists = this->hasProperty(globalObject, key);
                RETURN_IF_EXCEPTION(scope, );
                if (exists)
                    continue;

                PropertyDescriptor descriptor;
                bool found = holder->getOwnPropertyDescriptor(globalObject, key, descriptor);
                RETURN_IF_EXCEPTION(scope, );
                if (!found)
                    continue;
                putOwnProperty(globalObject, this, key, descriptor);
                RETURN_IF_EXCEPTION(scope, );
            }

            JSValue next = holder->getPrototype(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            if (!next.isObject())
                break;
            holder = asObject(next);
        }
    }

    JSArray* ensureArray(JSC::WriteBarrier<JSC::JSArray>& slot, const JSC::ArgList& values = JSC::ArgList())
    {
        JSArray* array = slot.get();
        if (!array) {
            array = JSC::constructArray(globalObject(), globalObject()->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), values);
            slot.set(vm(), this, array);
        }
        return array;
    }

    void materializeInstances(Recorded& recorded)
    {
        auto scope = DECLARE_THROW_SCOPE(vm());
        MarkedArgumentBuffer values;
        JSArray* source = recorded.instances ? nullptr : recorded.contexts.get();
        for (unsigned i = 0; source && i < source->length(); ++i)
            values.append(source->canGetIndexQuickly(i) ? source->getIndexQuickly(i) : jsUndefined());
        if (values.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject(), scope);
            return;
        }
        ensureArray(recorded.instances, values);
    }

    // The `fn.mock` object. Script can write to the arrays in it, so reading it counts as recording.
    JSObject* state()
    {
        auto& vm = this->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        Recorded& recorded = willRecord();
        if (JSObject* state = recorded.state.get())
            return state;

        materializeInstances(recorded);
        RETURN_IF_EXCEPTION(scope, nullptr);
        JSObject* state = JSC::constructEmptyObject(vm, mockModule().mockObjectStructure.getInitializedOnMainThread(globalObject()));
        state->putDirectOffset(vm, 0, ensureArray(recorded.calls));
        state->putDirectOffset(vm, 1, ensureArray(recorded.contexts));
        state->putDirectOffset(vm, 2, recorded.instances.get());
        state->putDirectOffset(vm, 3, ensureArray(recorded.returnValues));
        state->putDirectOffset(vm, 4, ensureArray(recorded.invocationCallOrder));
        recorded.state.set(vm, this, state);
        return state;
    }

    void clear()
    {
        m_recorded.calls.clear();
        m_recorded.instances.clear();
        m_recorded.returnValues.clear();
        m_recorded.contexts.clear();
        m_recorded.invocationCallOrder.clear();

        JSObject* state = m_recorded.state.get();
        if (state && !this->isVitest) {
            m_recorded.state.clear();
        } else if (state) {
            // In Vitest `fn.mock` stays the same object across mockClear().
            auto& vm = this->vm();
            // Same order as the offsets in mockObjectStructure.
            JSArray* arrays[] = { ensureArray(m_recorded.calls), ensureArray(m_recorded.contexts), ensureArray(m_recorded.instances), ensureArray(m_recorded.returnValues), ensureArray(m_recorded.invocationCallOrder) };
            static constexpr ASCIILiteral names[] = { "calls"_s, "contexts"_s, "instances"_s, "results"_s, "invocationCallOrder"_s };
            Structure* structure = state->structure();
            bool hasOriginalStructure = structure == this->mockModule().mockObjectStructure.getInitializedOnMainThread(this->globalObject());
            for (JSC::PropertyOffset offset = 0; offset < static_cast<JSC::PropertyOffset>(std::size(arrays)); ++offset) {
                if (hasOriginalStructure) {
                    structure->didReplaceProperty(offset);
                    state->putDirectOffset(vm, offset, arrays[offset]);
                } else {
                    state->putDirect(vm, Identifier::fromString(vm, names[offset]), arrays[offset], JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
                }
            }
        }
        leave(List::Called);
    }

    void resetConfiguration(JSGlobalObject* globalObject)
    {
        auto& vm = this->vm();
        m_configuration.tail.clear();
        m_configuration.mockName.clear();
        m_configuration.implementation.clear();
        JSValue initial = m_initialImplementation.get();
        if (!initial)
            m_configuration.fallbackImplmentation.clear();
        else if (JSValue fallback = m_configuration.fallbackImplmentation.get())
            m_configuration.implementation.set(vm, this, fallback);
        if (initial)
            setFallbackImplementation(JSMockImplementation::Kind::Call, initial);
        // Must come before updatePrototype(), which can run script that configures the mock again.
        leave(List::Configured);
        this->updatePrototype(globalObject);
    }

    void reset(JSGlobalObject* globalObject)
    {
        this->clear();
        this->resetConfiguration(globalObject);
    }

    // What mockReset() goes back to in Vitest: the function given to vi.fn(), or a spy's original. Only call it on a new mock.
    void setInitialImplementation(JSGlobalObject* globalObject, JSValue function)
    {
        ASSERT(!m_configuration.implementation && !m_initialImplementation);
        m_initialImplementation.set(vm(), this, function);
        setFallbackImplementation(JSMockImplementation::Kind::Call, function);
        this->updatePrototype(globalObject);
    }

    void pushImpl(JSGlobalObject* globalObject, JSMockImplementation::Kind kind, JSValue value)
    {
        willConfigure();
        setFallbackImplementation(kind, value);
        this->updatePrototype(globalObject);
    }

    void pushImplOnce(JSGlobalObject* globalObject, JSMockImplementation::Kind kind, JSValue value)
    {
        auto& vm = this->vm();
        Configuration& configuration = willConfigure();
        JSMockImplementation* impl = JSMockImplementation::create(this->globalObject(), mockModule().mockImplementationStructure.getInitializedOnMainThread(this->globalObject()), kind, value, true);

        if (auto* tail = tryJSDynamicCast<JSMockImplementation*, Unknown>(configuration.tail)) {
            tail->nextValueOrSentinel.set(vm, tail, impl);
        } else {
            configuration.implementation.set(vm, this, impl);
        }
        if (auto fallback = configuration.fallbackImplmentation.get()) {
            impl->nextValueOrSentinel.set(vm, impl, fallback);
        }
        configuration.tail.set(vm, this, impl);
        this->updatePrototype(globalObject);
    }

    JSMockImplementation* takeNextImplementation()
    {
        auto* impl = tryJSDynamicCast<JSMockImplementation*, Unknown>(m_configuration.implementation);
        if (impl && impl->isOnce()) {
            Configuration& configuration = willConfigure();
            auto next = impl->nextValueOrSentinel.get();
            configuration.implementation.set(vm(), this, next);
            if (next.isNumber() || !dynamicDowncast<JSMockImplementation>(next)->isOnce()) {
                configuration.tail.clear();
            }
        }
        return impl;
    }

    void setImplementations(JSGlobalObject* globalObject, JSValue implementation, JSValue tail, JSValue fallback)
    {
        auto& vm = this->vm();
        Configuration& configuration = willConfigure();
        configuration.implementation.set(vm, this, implementation);
        configuration.tail.set(vm, this, tail);
        configuration.fallbackImplmentation.set(vm, this, fallback);
        this->updatePrototype(globalObject);
    }

    void setPrototypeProperty(JSC::VM& vm, JSValue value)
    {
        this->hasLazyPrototype = false;
        this->putDirect(vm, vm.propertyNames->prototype, value, prototypeAttributes);
    }

    void materializePrototype(JSC::VM& vm)
    {
        JSObject* prototype = JSC::constructEmptyObject(this->globalObject());
        prototype->putDirect(vm, vm.propertyNames->constructor, this, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
        JSC::AllowLazyMaterializationOfImmutableProperties allowMaterialization(vm);
        this->setPrototypeProperty(vm, prototype);
    }

    JSValue prototypeProperty(JSGlobalObject* globalObject)
    {
        auto& vm = this->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (this->hasLazyPrototype) {
            this->materializePrototype(vm);
            this->updatePrototype(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return this->getDirect(vm, vm.propertyNames->prototype);
    }

    // Instances are created from `mock.prototype`, so the implementation's `prototype` is chained behind it.
    void setPrototypeParent(JSGlobalObject* globalObject, JSValue constructor)
    {
        auto& vm = this->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (this->isAutomock)
            return;
        if (this->hasLazyPrototype)
            this->materializePrototype(vm);
        JSValue prototype = this->getDirect(vm, vm.propertyNames->prototype);
        if (!prototype || !prototype.isObject())
            return;

        JSObject* parent = this->globalObject()->objectPrototype();
        if (constructor && constructor.isObject()) {
            JSValue constructorPrototype = asObject(constructor)->get(globalObject, vm.propertyNames->prototype);
            RETURN_IF_EXCEPTION(scope, );
            if (constructorPrototype.isObject())
                parent = asObject(constructorPrototype);
        }
        if (prototype == parent)
            return;
        JSValue currentParent = asObject(prototype)->getPrototype(globalObject);
        RETURN_IF_EXCEPTION(scope, );
        if (currentParent == parent)
            return;
        scope.release();
        asObject(prototype)->setPrototype(vm, globalObject, parent);
    }

    void updatePrototype(JSGlobalObject* globalObject)
    {
        if (this->hasLazyPrototype)
            return;
        auto* next = tryJSDynamicCast<JSMockImplementation*, Unknown>(m_configuration.implementation);
        this->setPrototypeParent(globalObject, next && next->kind == JSMockImplementation::Kind::Call ? next->underlyingValue.get() : JSValue());
    }

    bool isAccessorOf(GetterSetter* accessor)
    {
        if (accessor->getter() == this || accessor->setter() == this)
            return true;
        auto* getter = dynamicDowncast<JSBoundFunction>(accessor->getter());
        return getter && getter->boundThis() == this;
    }

    // `original` is getOwnPropertyStorage() of the replaced property, or empty if the target had no own one.
    void didInstall(JSObject* target, const Identifier& key, JSValue original, unsigned attributes);

    bool isRestoredSpy() const { return isSpy && !m_spyTarget; }

    // Puts the spied-on property back as it was; that can throw (a module namespace export, an indexed slot).
    void clearSpy(JSGlobalObject* globalObject, bool shouldReset = true)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        if (shouldReset) {
            this->reset(globalObject);
            RETURN_IF_EXCEPTION(scope, );
        }

        if (auto* target = m_spyTarget.get()) {
            this->putBackOriginal(globalObject, target);
            if (scope.exception()) [[unlikely]] {
                // It's still installed, so keep it where restoreAllMocks() finds it.
                enter(List::Spies);
                return;
            }
        }
        didUninstall();
    }

    static void clearAll(Zig::GlobalObject*);
    static void resetAll(Zig::GlobalObject*);
    static void restoreAll(Zig::GlobalObject*);
    static void didFinishTestFile(Zig::GlobalObject*);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSMockFunction, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSMockFunction, m_subspaceForJSMockFunction));
    }

    JSMockFunction(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, jsMockFunctionCall, jsMockFunctionConstruct)
    {
    }

private:
    enum class List : uint8_t {
        Called = 1 << 0,
        Configured = 1 << 1,
        Spies = 1 << 2,
    };

    static JSC::WriteBarrier<JSC::Unknown>& setOf(JSMockModule& mockModule, List list)
    {
        switch (list) {
        case List::Called:
            return mockModule.calledMocks;
        case List::Configured:
            return mockModule.configuredMocks;
        case List::Spies:
            return mockModule.activeSpies;
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    template<typename Functor> static void forEachIn(Zig::GlobalObject*, List, const Functor&);

    ALWAYS_INLINE void enter(List list)
    {
        if (!(m_lists & static_cast<uint8_t>(list))) [[unlikely]]
            enterSlow(list);
    }

    NEVER_INLINE void enterSlow(List list)
    {
        auto& vm = this->vm();
        auto& set = setOf(mockModule(), list);
        if (!set)
            set.set(vm, globalObject(), ActiveSpySet::create(vm, mockModule().activeSpySetStructure.getInitializedOnMainThread(globalObject())));
        uncheckedDowncast<ActiveSpySet>(set.get())->add(vm, this, this);
        m_lists |= static_cast<uint8_t>(list);
    }

    // Only clears the flag. The set keeps a stale entry, which forEachIn() skips, because removing one costs a rehash.
    void leave(List list)
    {
        m_lists &= ~static_cast<uint8_t>(list);
    }

    void didUninstall()
    {
        m_spyTarget.clear();
        m_spyOriginal.clear();
        m_spyIdentifier = JSC::Identifier();
        m_spyAttributes = 0;
        leave(List::Spies);
    }

    void setFallbackImplementation(JSMockImplementation::Kind kind, JSValue value)
    {
        auto& vm = this->vm();
        if (auto* current = tryJSDynamicCast<JSMockImplementation*, Unknown>(m_configuration.fallbackImplmentation)) {
            current->underlyingValue.set(vm, current, value);
            current->kind = kind;
            current->function.clear();
            return;
        }

        JSMockImplementation* impl = JSMockImplementation::create(globalObject(), mockModule().mockImplementationStructure.getInitializedOnMainThread(globalObject()), kind, value, false);
        m_configuration.fallbackImplmentation.set(vm, this, impl);
        if (auto* tail = tryJSDynamicCast<JSMockImplementation*, Unknown>(m_configuration.tail)) {
            tail->nextValueOrSentinel.set(vm, tail, impl);
        } else {
            m_configuration.implementation.set(vm, this, impl);
        }
    }

    void putBackOriginal(JSGlobalObject* globalObject, JSObject* target)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSValue original = m_spyOriginal.get();
        JSC::Identifier identifier = m_spyIdentifier;
        unsigned attributes = m_spyAttributes;

        if (attributes & SpyAttributeESModuleNamespace) {
            auto* moduleNamespaceObject = tryJSDynamicCast<JSModuleNamespaceObject*>(target);
            if (moduleNamespaceObject && original) {
                scope.release();
                moduleNamespaceObject->overrideExportValue(globalObject, identifier, original);
            }
            return;
        }

        if (attributes & SpyAttributeAccessor) {
            // Restoring the spy on the accessor's other half already put both halves back.
            unsigned currentAttributes = 0;
            JSValue current = getOwnPropertyStorage(globalObject, target, identifier, currentAttributes);
            RETURN_IF_EXCEPTION(scope, );
            auto* accessor = tryJSDynamicCast<GetterSetter*>(current);
            if (!accessor || !this->isAccessorOf(accessor))
                return;
        }

        scope.release();
        bool isOpaque = attributes & SpyAttributeOpaque;
        if (original) {
            putOwnPropertyStorage(globalObject, target, identifier, original, attributes & ~(SpyAttributeAccessor | SpyAttributeOpaque), isOpaque);
        } else if (!isOpaque && target->inherits<NodeVMGlobalObject>()) {
            // NodeVMGlobalObject::deleteProperty() deletes from the contextified object, where the spy never was.
            DeletePropertySlot slot;
            NodeVMGlobalObject::Base::deleteProperty(target, globalObject, identifier, slot);
        } else {
            JSCell::deleteProperty(target, globalObject, identifier);
        }
    }

    Recorded m_recorded;
    Configuration m_configuration;
    JSC::WriteBarrier<JSC::Unknown> m_initialImplementation;
    JSC::WriteBarrier<JSC::Unknown> m_spyOriginal;
    JSC::Weak<JSObject> m_spyTarget;
    JSC::Identifier m_spyIdentifier;
    unsigned m_spyAttributes { 0 };
    uint8_t m_lists { 0 };
};

template<typename Visitor>
void JSMockFunction::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    JSMockFunction* fn = this;
    ASSERT_GC_OBJECT_INHERITS(fn, info());

    visitor.append(fn->m_configuration.implementation);
    visitor.append(fn->m_configuration.tail);
    visitor.append(fn->m_configuration.fallbackImplmentation);
    visitor.append(fn->m_configuration.mockName);
    visitor.append(fn->m_recorded.calls);
    visitor.append(fn->m_recorded.contexts);
    visitor.append(fn->m_recorded.instances);
    visitor.append(fn->m_recorded.returnValues);
    visitor.append(fn->m_recorded.invocationCallOrder);
    visitor.append(fn->m_recorded.state);
    visitor.append(fn->m_spyOriginal);
    visitor.append(fn->prototypeMock);
    visitor.append(fn->m_initialImplementation);
}

template<typename Visitor>
void JSMockFunction::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSMockFunction* fn = uncheckedDowncast<JSMockFunction>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);
    fn->visitAdditionalChildrenInGCThread<Visitor>(visitor);
}

template<typename Visitor>
void JSMockFunction::visitOutputConstraintsImpl(JSCell* cell, Visitor& visitor)
{
    JSMockFunction* thisObject = uncheckedDowncast<JSMockFunction>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    thisObject->visitAdditionalChildrenInGCThread<Visitor>(visitor);
}

DEFINE_VISIT_CHILDREN(JSMockFunction);
DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSMockFunction);
DEFINE_VISIT_OUTPUT_CONSTRAINTS(JSMockFunction);

class JSMockFunctionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSMockFunctionPrototype* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSMockFunctionPrototype* ptr = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSMockFunctionPrototype))) JSMockFunctionPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSMockFunctionPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSMockFunctionPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

static const HashTableValue JSMockFunctionPrototypeTableValues[] = {
    { "mock"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsMockFunctionGetter_mock, 0 } },
    { "_protoImpl"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute | PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsMockFunctionGetter_protoImpl, 0 } },
    { "getMockImplementation"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionGetMockImplementation, 0 } },
    { "getMockName"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionGetMockName, 0 } },
    { "mockClear"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockClear, 0 } },
    { "mockReset"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockReset, 0 } },
    { "mockRestore"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockRestore, 0 } },
    { "mockImplementation"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockImplementation, 1 } },
    { "mockImplementationOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockImplementationOnce, 1 } },
    { "withImplementation"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionWithImplementation, 1 } },
    { "mockName"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockName, 1 } },
    { "mockReturnThis"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockReturnThis, 1 } },
    { "mockReturnValue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockReturnValue, 1 } },
    { "mockReturnValueOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockReturnValueOnce, 1 } },
    { "mockResolvedValue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockResolvedValue, 1 } },
    { "mockResolvedValueOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockResolvedValueOnce, 1 } },
    { "mockRejectedValue"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockRejectedValue, 1 } },
    { "mockRejectedValueOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockRejectedValueOnce, 1 } },
    { "mockThrow"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockThrow, 1 } },
    { "mockThrowOnce"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::NativeFunctionType, jsMockFunctionMockThrowOnce, 1 } },
};

const ClassInfo JSMockFunction::s_info = { "Mock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMockFunction) };

class SpyWeakHandleOwner final : public JSC::WeakHandleOwner {
public:
    void finalize(JSC::Handle<JSC::Unknown>, void* context) final {}
};

static SpyWeakHandleOwner& weakValueHandleOwner()
{
    static NeverDestroyed<SpyWeakHandleOwner> jscWeakValueHandleOwner;
    return jscWeakValueHandleOwner;
}

void JSMockFunction::didInstall(JSObject* target, const Identifier& key, JSValue original, unsigned attributes)
{
    enter(List::Spies);
    this->isSpy = true;
    m_spyTarget = JSC::Weak<JSObject>(target, &weakValueHandleOwner(), nullptr);
    m_spyIdentifier = key;
    m_spyAttributes = attributes;
    if (original)
        m_spyOriginal.set(vm(), this, original);
}

const ClassInfo JSMockFunctionPrototype::s_info = { "Mock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMockFunctionPrototype) };

// Detaches the set first, which drops its stale entries and lets script that `apply` runs register mocks in a new set.
// Every mock leaves, so `apply` must enter() the ones that stay. Keeps going after an exception and rethrows the first one at the end.
template<typename Functor>
void JSMockFunction::forEachIn(Zig::GlobalObject* globalObject, List list, const Functor& apply)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto& set = setOf(globalObject->mockModule, list);
    if (!set)
        return;

    MarkedArgumentBuffer mocks;
    uncheckedDowncast<ActiveSpySet>(set.get())->takeSnapshot(mocks);
    set.clear();
    JSC::Exception* firstException = nullptr;
    for (size_t i = 0; i < mocks.size(); ++i) {
        auto* mock = uncheckedDowncast<JSMockFunction>(mocks.at(i));
        if (!(mock->m_lists & static_cast<uint8_t>(list)))
            continue;
        mock->leave(list);
        apply(mock);
        if (auto* exception = scope.exception()) [[unlikely]] {
            if (!scope.tryClearException())
                return;
            if (!firstException)
                firstException = exception;
        }
    }
    if (firstException)
        throwException(globalObject, scope, firstException);
}

void JSMockFunction::restoreAll(Zig::GlobalObject* globalObject)
{
    // vi.restoreAllMocks() keeps a spy's calls and implementation.
    forEachIn(globalObject, List::Spies, [globalObject](JSMockFunction* spy) { spy->clearSpy(globalObject, !spy->isVitest); });
}

void JSMockFunction::clearAll(Zig::GlobalObject* globalObject)
{
    forEachIn(globalObject, List::Called, [](JSMockFunction* mock) { mock->clear(); });
}

void JSMockFunction::resetAll(Zig::GlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    clearAll(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    forEachIn(globalObject, List::Configured, [globalObject](JSMockFunction* mock) { mock->resetConfiguration(globalObject); });
}

// The next test file shares the global object, so this file's spies and recorded calls have to go.
// Configured mocks stay registered, because a module shared with the next file may own them.
__attribute__((minsize)) void JSMockFunction::didFinishTestFile(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer spiesOfPreload;
    JSC::Exception* firstException = nullptr;
    // Loop, because a Proxy trap hit while restoring one spy may install another.
    while (globalObject->mockModule.activeSpies) {
        forEachIn(globalObject, List::Spies, [&](JSMockFunction* spy) {
            if (spy->isMadeByPreload) {
                spiesOfPreload.append(spy);
                return;
            }
            auto scope = DECLARE_THROW_SCOPE(vm);
            spy->clearSpy(globalObject, !spy->isVitest);
            // Only this file gets the error. Forget the spy, so later files don't retry it.
            if (scope.exception()) [[unlikely]]
                spy->didUninstall();
        });
        if (auto* exception = scope.exception()) [[unlikely]] {
            if (!scope.tryClearException())
                return;
            if (!firstException)
                firstException = exception;
        }
    }
    for (size_t i = 0; i < spiesOfPreload.size(); ++i) {
        auto* spy = uncheckedDowncast<JSMockFunction>(spiesOfPreload.at(i));
        if (spy->m_spyTarget)
            spy->enter(List::Spies);
    }

    // Must run after restoring spies, since a Proxy trap may call a mock.
    forEachIn(globalObject, List::Called, [](JSMockFunction* mock) {
        if (mock->isMadeByPreload)
            mock->enter(List::Called);
        else
            mock->clear();
    });
    RETURN_IF_EXCEPTION(scope, );
    if (firstException)
        throwException(globalObject, scope, firstException);
}

extern "C" void JSMock__restoreAllMocks(Zig::GlobalObject* globalObject)
{
    JSMockFunction::restoreAll(globalObject);
}

extern "C" void JSMock__clearAllMocks(Zig::GlobalObject* globalObject)
{
    JSMockFunction::clearAll(globalObject);
}

extern "C" void JSMock__resetAllMocks(Zig::GlobalObject* globalObject)
{
    JSMockFunction::resetAll(globalObject);
}

extern "C" void JSMock__didFinishTestFile(Zig::GlobalObject* globalObject)
{
    JSMockFunction::didFinishTestFile(globalObject);
}

JSMockModule JSMockModule::create(JSC::JSGlobalObject* globalObject)
{
    JSMockModule mock;
    mock.mockFunctionStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            auto& vm = init.vm;
            auto* prototype = JSMockFunctionPrototype::create(vm, init.owner, JSMockFunctionPrototype::createStructure(vm, init.owner, init.owner->functionPrototype()));
            auto* structure = JSMockFunction::createStructure(vm, init.owner, prototype);
            init.set(structure);
        });
    mock.mockResultStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(init.owner);
            JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
                globalObject,
                globalObject->objectPrototype(),
                2);
            JSC::PropertyOffset offset;

            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "type"_s),
                0,
                offset);

            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "value"_s),

                0,
                offset);

            init.set(structure);
        });
    mock.activeSpySetStructure.initLater([](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
        Structure* implementation = ActiveSpySet::createStructure(init.vm, init.owner, jsNull());
        init.set(implementation);
    });

    mock.mockModuleStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            Structure* implementation = createModuleMockStructure(init.vm, init.owner, jsNull());
            init.set(implementation);
        });

    mock.mockImplementationStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            Structure* implementation = JSMockImplementation::createStructure(init.vm, init.owner, jsNull());
            init.set(implementation);
        });
    mock.mockObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::Structure>::Initializer& init) {
            Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(init.owner);

            auto* prototype = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());
            // `putDirectCustomAccessor` doesn't pass the `this` value as expected. unfortunatly we
            // need to use a JSFunction for the getter and assign it via `putDirectAccessor` instead.
            prototype->putDirectAccessor(
                globalObject,
                JSC::Identifier::fromString(init.vm, "lastCall"_s),
                JSC::GetterSetter::create(
                    init.vm,
                    globalObject,
                    JSC::JSFunction::create(init.vm, init.owner, 0, "lastCall"_s, jsMockFunctionGetter_mockGetLastCall, ImplementationVisibility::Public),
                    jsUndefined()),
                JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
            prototype->putDirectAccessor(
                globalObject,
                JSC::Identifier::fromString(init.vm, "settledResults"_s),
                JSC::GetterSetter::create(
                    init.vm,
                    globalObject,
                    JSC::JSFunction::create(init.vm, init.owner, 0, "settledResults"_s, jsMockFunctionGetter_mockGetSettledResults, ImplementationVisibility::Public),
                    jsUndefined()),
                JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);

            JSC::Structure* structure
                = globalObject->structureCache().emptyObjectStructureForPrototype(
                    globalObject,
                    prototype,
                    5);
            JSC::PropertyOffset offset;
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "calls"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "contexts"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "instances"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "results"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);
            structure = structure->addPropertyTransition(
                init.vm,
                structure,
                JSC::Identifier::fromString(init.vm, "invocationCallOrder"_s),
                JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly,
                offset);

            init.set(structure);
        });
    mock.lazyPrototype.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSCell>::Initializer& init) {
            init.set(JSC::CustomGetterSetter::create(init.vm, jsMockFunctionGetter_prototype, jsMockFunctionSetter_prototype));
        });
    mock.defaultName.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString>::Initializer& init) {
            init.set(JSC::jsNontrivialString(init.vm, "mockConstructor"_s));
        });
    mock.vitestName.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSString>::Initializer& init) {
            init.set(JSC::jsNontrivialString(init.vm, "Mock"_s));
        });
    mock.withImplementationCleanupFunction.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, JSC::JSFunction>::Initializer& init) {
            init.set(JSC::JSFunction::create(init.vm, init.owner, 2, String(), jsMockFunctionWithImplementationCleanup, ImplementationVisibility::Public));
        });
    mock.mockWithImplementationCleanupDataStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            init.set(Bun::MockWithImplementationCleanupData::createStructure(init.vm, init.owner, init.owner->objectPrototype()));
        });
    return mock;
}

template<typename Visitor> void JSMockModule::visit(Visitor& visitor)
{
#define VISIT_JSMOCKMODULE_GC_MEMBER(T, name) \
    name.visit(visitor);
    FOR_EACH_JSMOCKMODULE_GC_MEMBER(VISIT_JSMOCKMODULE_GC_MEMBER)
#undef VISIT_JSMOCKMODULE_GC_MEMBER
    visitor.append(activeSpies);
    visitor.append(calledMocks);
    visitor.append(configuredMocks);
    visitor.append(stubbedEnvs);
    visitor.append(stubbedGlobals);
    visitor.append(envsOfPreload);
    visitor.append(globalsOfPreload);
    visitor.append(dynamicImports);
}

template void JSMockModule::visit(JSC::AbstractSlotVisitor&);
template void JSMockModule::visit(JSC::SlotVisitor&);

// The `type` of a `mock.results[i]` entry: "return", "throw" or "incomplete".
enum class MockResultType : uint8_t {
    Return,
    Throw,
    Incomplete,
};

static JSC::JSString* mockResultTypeString(JSC::VM& vm, MockResultType type)
{
    auto& commonStrings = Bun::commonStrings(vm);
    switch (type) {
    case MockResultType::Return:
        return commonStrings.mockResultReturnString();
    case MockResultType::Throw:
        return commonStrings.mockResultThrowString();
    case MockResultType::Incomplete:
        return commonStrings.mockResultIncompleteString();
    }
    RELEASE_ASSERT_NOT_REACHED();
}

static JSC::JSObject* createMockResult(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSString* type, JSC::JSValue value)
{
    JSC::Structure* structure = globalObject->mockModule.mockResultStructure.getInitializedOnMainThread(globalObject);
    JSC::JSObject* result = JSC::constructEmptyObject(vm, structure);
    result->putDirectOffset(vm, 0, type);
    result->putDirectOffset(vm, 1, value);
    return result;
}

// Script has had access to `result` since createMockResult(), so its structure may have changed.
static ALWAYS_INLINE void completeMockResult(JSC::VM& vm, Zig::GlobalObject* globalObject, JSC::JSObject* result, MockResultType type, JSC::JSValue value)
{
    JSC::Structure* structure = result->structure();
    if (structure != globalObject->mockModule.mockResultStructure.getInitializedOnMainThread(globalObject)) [[unlikely]] {
        result->putDirect(vm, vm.propertyNames->type, mockResultTypeString(vm, type));
        result->putDirect(vm, vm.propertyNames->value, value);
        return;
    }
    structure->didReplaceProperty(0);
    result->putDirectOffset(vm, 0, mockResultTypeString(vm, type));
    structure->didReplaceProperty(1);
    result->putDirectOffset(vm, 1, value);
}

static JSMockFunction* createMockFunction(JSC::VM& vm, Zig::GlobalObject* globalObject, bool isVitest)
{
    auto* mock = JSMockFunction::create(vm, globalObject);
    mock->isVitest = isVitest;
    if (globalObject->mockModule.preloadMayBeRunning) [[unlikely]]
        mock->isMadeByPreload = JSMock__isInPreload(globalObject);
    return mock;
}

extern "C" void JSMock__willRunTest(Zig::GlobalObject* globalObject)
{
    globalObject->mockModule.preloadMayBeRunning = false;
}

static ALWAYS_INLINE JSC::JSArray* createArgumentsArray(JSC::VM& vm, Zig::GlobalObject* globalObject, const JSC::ArgList& args)
{
    JSC::ObjectInitializationScope object(vm);
    JSC::JSArray* array = JSC::JSArray::tryCreateUninitializedRestricted(
        object,
        globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
        args.size());
    if (!array) [[unlikely]]
        return nullptr;
    if (array->indexingType() == JSC::ArrayWithContiguous) [[likely]] {
        for (size_t i = 0; i < args.size(); i++)
            array->initializeIndexWithoutBarrier(object, i, args.at(i), JSC::ArrayWithContiguous);
    } else {
        for (size_t i = 0; i < args.size(); i++)
            array->initializeIndex(object, i, args.at(i));
    }
    return array;
}

static NEVER_INLINE JSC::JSArray* appendToMockStateSlow(Zig::GlobalObject* globalObject, JSMockFunction* fn, JSC::WriteBarrier<JSC::JSArray>& state, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (JSC::JSArray* array = state.get()) {
        scope.release();
        array->push(globalObject, value);
        return array;
    }

    JSC::JSArray* array = nullptr;
    {
        JSC::ObjectInitializationScope object(vm);
        array = JSC::JSArray::tryCreateUninitializedRestricted(
            object,
            globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
            1);
        if (array) [[likely]]
            array->initializeIndex(object, 0, value);
    }
    if (!array) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    state.set(vm, fn, array);
    return array;
}

struct MockInvocation {
    JSC::JSArray* contexts { nullptr };
    JSC::JSArray* instances { nullptr };
    unsigned contextIndex { 0 };
    unsigned instanceIndex { 0 };

    void setInstance(JSC::JSGlobalObject* globalObject, JSC::JSObject* instance)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        contexts->putDirectIndex(globalObject, contextIndex, instance);
        RETURN_IF_EXCEPTION(scope, );
        scope.release();
        instances->putDirectIndex(globalObject, instanceIndex, instance);
    }
};

static ALWAYS_INLINE void recordInvocation(Zig::GlobalObject* globalObject, JSMockFunction* fn, JSC::JSArray* arguments, JSC::JSValue thisValue, uint64_t invocationId, JSC::JSObject* result, MockInvocation* invocationOfNew = nullptr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSMockFunction::Recorded& recorded = fn->willRecord();

    // Only an unmodified contiguous array with spare capacity can take an element with no chance of running script.
    JSC::StructureID plainArray = globalObject->originalArrayStructureForIndexingType(JSC::ArrayWithContiguous)->id();
    auto append = [&](JSC::WriteBarrier<JSC::JSArray>& state, JSC::JSValue value) ALWAYS_INLINE_LAMBDA -> JSC::JSArray* {
        JSC::JSArray* array = state.get();
        if (array && array->structureID() == plainArray) [[likely]] {
            JSC::Butterfly* butterfly = array->butterfly();
            unsigned length = butterfly->publicLength();
            if (length < butterfly->vectorLength()) [[likely]] {
                butterfly->contiguous().at(array, length).setWithoutWriteBarrier(value);
                butterfly->setPublicLength(length + 1);
                vm.writeBarrier(array, value);
                return array;
            }
        }
        array = appendToMockStateSlow(globalObject, fn, state, value);
        // Script may have run and cleared the mock, so register it again.
        fn->willRecord();
        return scope.exception() ? nullptr : array;
    };

    if (invocationOfNew) {
        fn->materializeInstances(recorded);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (!append(recorded.calls, arguments))
        return;
    JSC::JSArray* contexts = append(recorded.contexts, thisValue);
    if (!contexts)
        return;
    if (invocationOfNew) {
        invocationOfNew->contexts = contexts;
        invocationOfNew->contextIndex = contexts->length() - 1;
    }
    if (invocationOfNew || recorded.instances) {
        JSC::JSArray* instances = append(recorded.instances, thisValue);
        if (!instances)
            return;
        if (invocationOfNew) {
            invocationOfNew->instances = instances;
            invocationOfNew->instanceIndex = instances->length() - 1;
        }
    }
    if (!append(recorded.invocationCallOrder, jsNumber(invocationId)))
        return;
    append(recorded.returnValues, result);
}

static NEVER_INLINE void recordInvocationOutOfLine(Zig::GlobalObject* globalObject, JSMockFunction* fn, JSC::JSArray* arguments, JSC::JSValue thisValue, uint64_t invocationId, JSC::JSObject* result, MockInvocation* invocationOfNew)
{
    recordInvocation(globalObject, fn, arguments, thisValue, invocationId, result, invocationOfNew);
}

// The other kinds can't throw or observe their own "incomplete" result, so their final result is recorded up front.
static ALWAYS_INLINE bool runsScriptOrThrows(JSMockImplementation* impl)
{
    return impl->kind == JSMockImplementation::Kind::Call || impl->kind == JSMockImplementation::Kind::ThrowValue;
}

static ALWAYS_INLINE JSC::JSValue valueOfMockImplementation(JSC::JSGlobalObject* globalObject, JSMockImplementation* impl, JSC::JSValue thisValue)
{
    switch (impl->kind) {
    case JSMockImplementation::Kind::ReturnValue:
    case JSMockImplementation::Kind::Nothing:
        return impl->underlyingValue.get();
    case JSMockImplementation::Kind::ReturnThis:
        return thisValue;
    case JSMockImplementation::Kind::RejectedValue:
        return JSC::JSPromise::rejectedPromise(globalObject, impl->underlyingValue.get());
    case JSMockImplementation::Kind::Call:
    case JSMockImplementation::Kind::ThrowValue:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

static NEVER_INLINE JSC::JSValue runMockImplementationThatIsNoFunction(JSC::JSGlobalObject* globalObject, JSMockImplementation* impl, JSC::JSValue thisValue)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (impl->kind == JSMockImplementation::Kind::ThrowValue) {
        throwException(globalObject, scope, impl->underlyingValue.get());
        return {};
    }
    RELEASE_AND_RETURN(scope, valueOfMockImplementation(globalObject, impl, thisValue));
}

// Handles every kind: script that ran while the call was recorded may have reconfigured the mock, which mutates `impl` in place.
static ALWAYS_INLINE JSC::JSValue runMockImplementation(JSC::JSGlobalObject* globalObject, JSMockImplementation* impl, JSC::JSValue thisValue, const JSC::ArgList& args)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (impl->kind != JSMockImplementation::Kind::Call) [[unlikely]]
        RELEASE_AND_RETURN(scope, runMockImplementationThatIsNoFunction(globalObject, impl, thisValue));
    JSValue function = impl->underlyingValue.get();
    JSC::CallData callData = JSC::getCallData(function);
    if (callData.type == JSC::CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "Expected mock implementation to be callable"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSC::call(globalObject, function, callData, thisValue, args));
}

static void mockInstanceMethods(Zig::GlobalObject* globalObject, JSMockFunction* fn, JSC::JSObject* instance)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue prototypeValue = fn->prototypeProperty(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    if (!prototypeValue || !prototypeValue.isObject())
        return;
    JSObject* prototype = asObject(prototypeValue);

    JSC::PropertyNameArrayBuilder keys(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    prototype->methodTable()->getOwnPropertyNames(prototype, globalObject, keys, JSC::DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, );

    for (const auto& key : keys) {
        if (key == vm.propertyNames->constructor)
            continue;

        JSC::PropertySlot slot(prototype, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
        bool found = prototype->methodTable()->getOwnPropertySlot(prototype, globalObject, key, slot);
        RETURN_IF_EXCEPTION(scope, );
        if (!found || !slot.isValue())
            continue;
        JSValue method = slot.getValue(globalObject, key);
        RETURN_IF_EXCEPTION(scope, );
        auto* prototypeMock = dynamicDowncast<JSMockFunction>(method);
        if (!prototypeMock)
            continue;

        JSValue inherited = instance->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, );
        if (inherited != method)
            continue;

        auto* mock = createMockFunction(vm, globalObject, prototypeMock->isVitest);
        mock->isJest = prototypeMock->isJest;
        mock->copyNameAndLength(vm, globalObject, prototypeMock);
        RETURN_IF_EXCEPTION(scope, );
        mock->prototypeMock.set(vm, mock, prototypeMock);

        JSC::PutPropertySlot putSlot(instance);
        instance->methodTable()->put(instance, globalObject, key, mock, putSlot);
        RETURN_IF_EXCEPTION(scope, );
    }
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionCall, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    JSMockFunction* fn = dynamicDowncast<JSMockFunction>(callframe->jsCallee());
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!fn) [[unlikely]] {
        throwTypeError(globalObject, scope, "Expected callee to be mock function"_s);
        return {};
    }

    JSC::ArgList args = JSC::ArgList(callframe);
    JSValue thisValue = callframe->thisValue().toThis(globalObject, ECMAMode::strict());
    JSC::JSArray* argumentsArray = createArgumentsArray(vm, globalObject, args);
    if (!argumentsArray) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    JSMockFunction* prototypeMock = fn->prototypeMock.get();
    JSMockImplementation* impl = fn->takeNextImplementation();
    if (!impl && prototypeMock) [[unlikely]]
        impl = prototypeMock->takeNextImplementation();

    bool isIncomplete = impl && runsScriptOrThrows(impl);
    JSValue returnValue = jsUndefined();
    if (impl && !isIncomplete) {
        returnValue = valueOfMockImplementation(globalObject, impl, thisValue);
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSObject* result = createMockResult(vm, globalObject, mockResultTypeString(vm, isIncomplete ? MockResultType::Incomplete : MockResultType::Return), returnValue);
    auto invocationId = JSMockModule::nextInvocationId();
    recordInvocation(globalObject, fn, argumentsArray, thisValue, invocationId, result);
    RETURN_IF_EXCEPTION(scope, {});
    if (prototypeMock) [[unlikely]] {
        recordInvocationOutOfLine(globalObject, prototypeMock, argumentsArray, thisValue, invocationId, result, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (!isIncomplete)
        return JSValue::encode(returnValue);

    returnValue = runMockImplementation(globalObject, impl, thisValue, args);
    if (auto* exception = scope.exception()) [[unlikely]] {
        completeMockResult(vm, globalObject, result, MockResultType::Throw, exception->value());
        return {};
    }
    completeMockResult(vm, globalObject, result, MockResultType::Return, returnValue);
    return JSValue::encode(returnValue);
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionConstruct, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    JSMockFunction* fn = dynamicDowncast<JSMockFunction>(callframe->jsCallee());
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!fn) [[unlikely]] {
        throwTypeError(globalObject, scope, "Expected callee to be mock function"_s);
        return {};
    }

    JSC::ArgList args = JSC::ArgList(callframe);
    JSObject* newTarget = asObject(callframe->newTarget());
    JSC::JSArray* argumentsArray = createArgumentsArray(vm, globalObject, args);
    if (!argumentsArray) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    JSMockFunction* prototypeMock = fn->prototypeMock.get();
    JSMockImplementation* impl = fn->takeNextImplementation();
    if (!impl && prototypeMock)
        impl = prototypeMock->takeNextImplementation();

    JSValue constructor;
    if (impl && impl->kind == JSMockImplementation::Kind::Call)
        constructor = impl->underlyingValue.get();
    fn->setPrototypeParent(globalObject, constructor);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::CallData constructData;
    if (constructor)
        constructData = JSC::getConstructData(constructor);
    // Jest calls the implementation on the new object instead of constructing it, except for a class, which can't be called.
    if (!fn->isVitest && constructData.type == JSC::CallData::Type::JS && !constructData.js.functionExecutable->isClassConstructorFunction())
        constructData = {};
    bool constructs = constructData.type != JSC::CallData::Type::None;
    JSValue thisValue = jsUndefined();
    if (!constructs) {
        // Not constructible (arrow function, method, mockReturnValue(), nothing): act like `new` on a plain function that wraps it.
        JSC::Structure* structure = JSC::InternalFunction::createSubclassStructure(globalObject, newTarget, globalObject->objectStructureForObjectConstructor());
        RETURN_IF_EXCEPTION(scope, {});
        thisValue = JSC::constructEmptyObject(vm, structure);
    }

    JSObject* result = createMockResult(vm, globalObject, mockResultTypeString(vm, MockResultType::Incomplete), jsUndefined());
    auto invocationId = JSMockModule::nextInvocationId();
    MockInvocation invocation;
    recordInvocationOutOfLine(globalObject, fn, argumentsArray, thisValue, invocationId, result, &invocation);
    RETURN_IF_EXCEPTION(scope, {});
    MockInvocation prototypeInvocation;
    if (prototypeMock) {
        recordInvocationOutOfLine(globalObject, prototypeMock, argumentsArray, thisValue, invocationId, result, &prototypeInvocation);
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSValue returnValue = jsUndefined();
    if (constructs)
        returnValue = JSC::construct(globalObject, constructor, constructData, args, newTarget);
    else if (impl)
        returnValue = runMockImplementation(globalObject, impl, thisValue, args);
    // For `new`, Jest records what the implementation returned and Vitest records the instance.
    JSValue resultValue = returnValue;
    if (!scope.exception()) {
        if (!returnValue.isObject())
            returnValue = thisValue;
        if (fn->isVitest)
            resultValue = returnValue;
        if (fn->isAutomock)
            mockInstanceMethods(globalObject, fn, asObject(returnValue));
    }
    if (auto* exception = scope.exception()) [[unlikely]] {
        completeMockResult(vm, globalObject, result, MockResultType::Throw, exception->value());
        return {};
    }
    completeMockResult(vm, globalObject, result, MockResultType::Return, resultValue);

    if (constructs) {
        invocation.setInstance(globalObject, asObject(returnValue));
        RETURN_IF_EXCEPTION(scope, {});
        if (prototypeMock) {
            prototypeInvocation.setInstance(globalObject, asObject(returnValue));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    return JSValue::encode(returnValue);
}

void JSMockFunctionPrototype::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSMockFunction::info(), JSMockFunctionPrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());

    this->putDirect(vm, Identifier::fromString(vm, "_isMockFunction"_s), jsBoolean(true), 0);

    // Support `using spy = spyOn(...)` — auto-restores when leaving scope.
    JSValue restoreFn = this->getDirect(vm, Identifier::fromString(vm, "mockRestore"_s));
    this->putDirect(vm, vm.propertyNames->disposeSymbol, restoreFn, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum));
}

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsMockFunctionGetMockImplementation, __attribute__((minsize)), (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    using Kind = JSMockImplementation::Kind;
    auto* implementation = tryJSDynamicCast<JSMockImplementation*, Unknown>(thisObject->configuration().implementation);
    if (implementation && implementation->isOnce()) {
        // Vitest returns what the next call runs, Jest what stays. Outside Vitest, mockImplementationOnce()'s function has always been returned too.
        bool isReturnedBeforeItsCall = implementation->kind == Kind::Call || (thisObject->isVitest && implementation->kind != Kind::Nothing);
        if (!isReturnedBeforeItsCall)
            implementation = tryJSDynamicCast<JSMockImplementation*, Unknown>(thisObject->configuration().fallbackImplmentation);
    }
    if (!implementation || implementation->kind == Kind::Nothing)
        return JSValue::encode(jsUndefined());
    if (implementation->kind == Kind::Call)
        return JSValue::encode(implementation->underlyingValue.get());
    if (JSObject* function = implementation->function.get())
        return JSValue::encode(function);

    JSC::NativeFunction body = jsMockFunctionReturnThis;
    if (implementation->kind == Kind::RejectedValue)
        body = jsMockFunctionRejectWithThis;
    else if (implementation->kind == Kind::ThrowValue)
        body = jsMockFunctionThrowThis;
    JSObject* function = JSC::JSFunction::create(vm, globalObject, 0, String(), body, ImplementationVisibility::Public);
    if (implementation->kind != Kind::ReturnThis) {
        function = JSC::JSBoundFunction::create(vm, globalObject, function, implementation->underlyingValue.get(), ArgList(), 0, nullptr, makeSource(String(), SourceOrigin(), SourceTaintedOrigin::Untainted));
        RETURN_IF_EXCEPTION(scope, {});
    }
    implementation->function.set(vm, implementation, function);
    return JSValue::encode(function);
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionReturnThis, (JSC::JSGlobalObject*, JSC::CallFrame* callframe))
{
    return JSValue::encode(callframe->thisValue());
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionRejectWithThis, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSPromise::rejectedPromise(globalObject, callframe->thisValue())));
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionThrowThis, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    throwException(globalObject, scope, callframe->thisValue());
    return {};
}

JSC_DEFINE_CUSTOM_GETTER(jsMockFunctionGetter_mock, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Bun::JSMockFunction* thisObject = dynamicDowncast<Bun::JSMockFunction>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    CHECK_IS_MOCK_FUNCTION(JSValue::decode(thisValue))

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->state()));
}

JSC_DEFINE_CUSTOM_GETTER(jsMockFunctionGetter_prototype, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    // For a CustomValue, `thisValue` is the object that holds the property, not the receiver.
    auto* mock = dynamicDowncast<JSMockFunction>(JSValue::decode(thisValue));
    return JSValue::encode(mock ? mock->prototypeProperty(globalObject) : jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(jsMockFunctionSetter_prototype, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName))
{
    auto* mock = dynamicDowncast<JSMockFunction>(JSValue::decode(thisValue));
    if (mock)
        mock->setPrototypeProperty(JSC::getVM(globalObject), JSValue::decode(value));
    return !!mock;
}

JSC_DEFINE_CUSTOM_GETTER(jsMockFunctionGetter_protoImpl, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Bun::JSMockFunction* thisObject = dynamicDowncast<Bun::JSMockFunction>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    CHECK_IS_MOCK_FUNCTION(JSValue::decode(thisValue))

    if (auto* impl = tryJSDynamicCast<JSMockImplementation*, Unknown>(thisObject->configuration().implementation)) {
        if (impl->kind == JSMockImplementation::Kind::Call) {
            if (impl->underlyingValue) {
                return JSValue::encode(impl->underlyingValue.get());
            }
        }
    }

    return JSValue::encode(jsUndefined());
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSMockFunction__getCalls(JSC::JSGlobalObject* globalThis, EncodedJSValue encodedValue)
{
    auto scope = DECLARE_THROW_SCOPE(globalThis->vm());
    JSValue value = JSValue::decode(encodedValue);
    if (auto* mock = tryJSDynamicCast<JSMockFunction*>(value)) {
        if (JSArray* calls = mock->recorded().calls.get())
            return JSValue::encode(calls);
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::constructEmptyArray(globalThis, nullptr)));
    }
    return encodedJSUndefined();
}
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSMockFunction__getReturns(JSC::JSGlobalObject* globalThis, EncodedJSValue encodedValue)
{
    auto scope = DECLARE_THROW_SCOPE(globalThis->vm());
    JSValue value = JSValue::decode(encodedValue);
    if (auto* mock = tryJSDynamicCast<JSMockFunction*>(value)) {
        if (JSArray* returnValues = mock->recorded().returnValues.get())
            return JSValue::encode(returnValues);
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::constructEmptyArray(globalThis, nullptr)));
    }
    return encodedJSUndefined();
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionGetMockName, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue)

    auto* jsName = thisObject->jsName();
    if (thisObject->isJest || thisObject->isVitest) {
        auto* mockName = thisObject->configuration().mockName.get();
        if (!mockName && thisObject->isVitest && thisObject->isSpy)
            mockName = jsName;
        if (mockName && mockName->length())
            return JSValue::encode(mockName);
        return JSValue::encode(jsNontrivialString(vm, thisObject->isVitest ? "vi.fn()"_s : "jest.fn()"_s));
    }
    if (!jsName) {
        return JSValue::encode(jsEmptyString(vm));
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsName));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockClear, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->clear();
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReset, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->reset(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockRestore, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->clearSpy(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockImplementation, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);

    JSValue thisValue = callframe->thisValue();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    CHECK_IS_MOCK_FUNCTION(thisValue);

    JSValue value = callframe->argument(0);

    // This check is for a jest edge case, truthy values will throw but not immediatly, and falsy values return undefined.
    if (value.toBoolean(globalObject)) {
        thisObject->pushImpl(globalObject, JSMockImplementation::Kind::Call, value);
    } else {
        thisObject->pushImpl(globalObject, JSMockImplementation::Kind::Nothing, jsUndefined());
    }
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockImplementationOnce, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);

    JSValue thisValue = callframe->thisValue();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    CHECK_IS_MOCK_FUNCTION(thisValue);

    JSValue value = callframe->argument(0);

    // This check is for a jest edge case, truthy values will throw but not immediatly, and falsy values return undefined.
    if (value.toBoolean(globalObject)) {
        thisObject->pushImplOnce(globalObject, JSMockImplementation::Kind::Call, value);
    } else {
        thisObject->pushImplOnce(globalObject, JSMockImplementation::Kind::Nothing, jsUndefined());
    }
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockName, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    // https://github.com/jestjs/jest/blob/bd1c6db7c15c23788ca3e09c919138e48dd3b28a/packages/jest-mock/src/index.ts#L849-L856
    if (thisObject->isVitest) {
        if (callframe->argument(0).isString()) {
            thisObject->willConfigure().mockName.set(vm, thisObject, asString(callframe->argument(0)));
        }
    } else if (callframe->argument(0).toBoolean(globalObject)) {
        JSString* name = callframe->argument(0).toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (thisObject->isJest) {
            thisObject->willConfigure().mockName.set(vm, thisObject, name);
        } else {
            auto nameString = name->value(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            thisObject->setName(nameString);
        }
    } else {
        RETURN_IF_EXCEPTION(scope, {});
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject));
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnThis, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->pushImpl(globalObject, JSMockImplementation::Kind::ReturnThis, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->pushImpl(globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockReturnValueOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->pushImplOnce(globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockResolvedValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    auto* promise = JSC::JSPromise::resolvedPromise(globalObject, callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    thisObject->pushImpl(globalObject, JSMockImplementation::Kind::ReturnValue, promise);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockResolvedValueOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    auto* promise = JSC::JSPromise::resolvedPromise(globalObject, callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    thisObject->pushImplOnce(globalObject, JSMockImplementation::Kind::ReturnValue, promise);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockRejectedValue, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->pushImpl(globalObject, JSMockImplementation::Kind::RejectedValue, callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockRejectedValueOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->pushImplOnce(globalObject, JSMockImplementation::Kind::RejectedValue, callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockThrow, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->pushImpl(globalObject, JSMockImplementation::Kind::ThrowValue, callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockThrowOnce, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    thisObject->pushImplOnce(globalObject, JSMockImplementation::Kind::ThrowValue, callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(thisObject);
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionGetter_mockGetLastCall, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSValue thisObject = callframe->thisValue().toThis(globalObject, ECMAMode::strict());
    if (!thisObject.isObject()) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }
    JSValue callsValue = thisObject.get(globalObject, Identifier::fromString(vm, "calls"_s));
    RETURN_IF_EXCEPTION(throwScope, {});

    if (auto callsArray = dynamicDowncast<JSC::JSArray>(callsValue)) {
        auto len = callsArray->length();
        if (len > 0) {
            RELEASE_AND_RETURN(throwScope, JSValue::encode(callsArray->getIndex(globalObject, len - 1)));
        }
    }
    return JSValue::encode(jsUndefined());
}

// With ArrayStorage, or on a non-JSArray, `length` can be huge with few elements, so only the indices that exist are visited.
template<typename Functor>
static void forEachElement(JSGlobalObject* globalObject, JSObject* array, unsigned length, const Functor& apply)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (JSC::isJSArray(array) && !JSC::hasAnyArrayStorage(array->indexingType())) {
        for (unsigned i = 0; i < length; ++i) {
            apply(i);
            RETURN_IF_EXCEPTION(scope, );
        }
        return;
    }

    JSC::PropertyNameArrayBuilder keys(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
    array->methodTable()->getOwnPropertyNames(array, globalObject, keys, JSC::DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, );
    for (const auto& key : keys) {
        auto index = parseIndex(key);
        if (!index || *index >= length)
            continue;
        apply(*index);
        RETURN_IF_EXCEPTION(scope, );
    }
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionGetter_mockGetSettledResults, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = callframe->thisValue().toThis(globalObject, ECMAMode::strict());
    if (!thisValue.isObject()) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }
    JSValue resultsValue = thisValue.get(globalObject, Identifier::fromString(vm, "results"_s));
    RETURN_IF_EXCEPTION(scope, {});
    auto* results = dynamicDowncast<JSC::JSArray>(resultsValue);
    if (!results) {
        return JSValue::encode(jsUndefined());
    }

    JSString* incomplete = mockResultTypeString(vm, MockResultType::Incomplete);
    JSString* fulfilled = jsNontrivialString(vm, "fulfilled"_s);
    JSString* rejected = jsNontrivialString(vm, "rejected"_s);

    JSC::JSArray* settledResults = JSC::constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    unsigned length = results->length();
    forEachElement(globalObject, results, length, [&](unsigned i) {
        JSValue result = results->getIndex(globalObject, i);
        if (scope.exception())
            return;
        JSValue type = jsUndefined();
        JSValue value = jsUndefined();
        if (result.isObject()) {
            type = asObject(result)->get(globalObject, vm.propertyNames->type);
            if (scope.exception())
                return;
            value = asObject(result)->get(globalObject, vm.propertyNames->value);
            if (scope.exception())
                return;
        }

        bool didThrow = false;
        bool didReturn = false;
        if (type.isString()) {
            didThrow = asString(type)->equal(globalObject, mockResultTypeString(vm, MockResultType::Throw));
            if (scope.exception())
                return;
            didReturn = asString(type)->equal(globalObject, mockResultTypeString(vm, MockResultType::Return));
            if (scope.exception())
                return;
        }

        JSString* settledType = incomplete;
        JSValue settledValue = jsUndefined();
        if (didThrow) {
            settledType = rejected;
            settledValue = value;
        } else if (didReturn) {
            auto* promise = dynamicDowncast<JSC::JSPromise>(value);
            if (!promise) {
                settledType = fulfilled;
                settledValue = value;
            } else if (promise->status() != JSC::JSPromise::Status::Pending) {
                settledType = promise->status() == JSC::JSPromise::Status::Fulfilled ? fulfilled : rejected;
                settledValue = promise->result();
            }
        }
        settledResults->putDirectIndex(globalObject, i, createMockResult(vm, globalObject, settledType, settledValue));
    });
    RETURN_IF_EXCEPTION(scope, {});
    settledResults->setLength(globalObject, length, true);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(settledResults);
}

const JSC::ClassInfo MockWithImplementationCleanupData::s_info = { "MockWithImplementationCleanupData"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(MockWithImplementationCleanupData) };

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* MockWithImplementationCleanupData::subspaceFor(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<MockWithImplementationCleanupData, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForMockWithImplementationCleanupData, m_subspaceForMockWithImplementationCleanupData));
}

MockWithImplementationCleanupData* MockWithImplementationCleanupData::create(VM& vm, Structure* structure)
{
    MockWithImplementationCleanupData* mod = new (NotNull, allocateCell<MockWithImplementationCleanupData>(vm)) MockWithImplementationCleanupData(vm, structure);
    return mod;
}
Structure* MockWithImplementationCleanupData::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(ObjectType, StructureFlags), info());
}

MockWithImplementationCleanupData::MockWithImplementationCleanupData(VM& vm, Structure* structure)
    : Base(vm, structure)
{
}

void MockWithImplementationCleanupData::finishCreation(VM& vm, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback)
{
    Base::finishCreation(vm);
    this->internalField(0).set(vm, this, fn);
    this->internalField(1).set(vm, this, impl);
    this->internalField(2).set(vm, this, tail);
    this->internalField(3).set(vm, this, fallback);
}

template<typename Visitor>
void MockWithImplementationCleanupData::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<MockWithImplementationCleanupData>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(MockWithImplementationCleanupData);

MockWithImplementationCleanupData* MockWithImplementationCleanupData::create(JSC::JSGlobalObject* globalObject, JSMockFunction* fn, JSValue impl, JSValue tail, JSValue fallback)
{
    auto* obj = create(globalObject->vm(), static_cast<Zig::GlobalObject*>(globalObject)->mockModule.mockWithImplementationCleanupDataStructure.getInitializedOnMainThread(globalObject));
    obj->finishCreation(globalObject->vm(), fn, impl, tail, fallback);
    return obj;
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionWithImplementationCleanup, (JSC::JSGlobalObject * jsGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = jsGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto ctx = dynamicDowncast<MockWithImplementationCleanupData>(callframe->argument(1));
    if (!ctx) {
        return JSValue::encode(jsUndefined());
    }

    auto fn = dynamicDowncast<JSMockFunction>(ctx->internalField(0).get());
    fn->setImplementations(jsGlobalObject, ctx->internalField(1).get(), ctx->internalField(2).get(), ctx->internalField(3).get());
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsMockFunctionWithImplementation, (JSC::JSGlobalObject * jsGlobalObject, JSC::CallFrame* callframe))
{
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(jsGlobalObject);

    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    JSValue tempImplValue = callframe->argument(0);
    JSValue callback = callframe->argument(1);
    JSC::CallData callData = JSC::getCallData(callback);
    if (callData.type == JSC::CallData::Type::None) [[unlikely]] {
        throwTypeError(globalObject, scope, "Expected mock implementation to be callable"_s);
        return {};
    }

    auto lastImpl = thisObject->configuration().implementation.get();
    auto lastTail = thisObject->configuration().tail.get();
    auto lastFallback = thisObject->configuration().fallbackImplmentation.get();

    JSMockImplementation* impl = JSMockImplementation::create(
        globalObject,
        globalObject->mockModule.mockImplementationStructure.getInitializedOnMainThread(globalObject),
        JSMockImplementation::Kind::Call,
        tempImplValue,
        false);

    thisObject->setImplementations(globalObject, impl, JSValue(), JSValue());
    RETURN_IF_EXCEPTION(scope, {});

    MarkedArgumentBuffer args;
    NakedPtr<JSC::Exception> exception;
    JSValue returnValue = JSC::call(globalObject, callback, callData, jsUndefined(), args, exception);
    if (exception) [[unlikely]] {
        throwException(globalObject, scope, exception.get());
        return {};
    }

    if (auto promise = tryJSDynamicCast<JSC::JSPromise*>(returnValue)) {
        auto capability = JSC::JSPromise::createNewPromiseCapability(globalObject, globalObject->promiseConstructor());
        RETURN_IF_EXCEPTION(scope, {});
        auto ctx = MockWithImplementationCleanupData::create(globalObject, thisObject, lastImpl, lastTail, lastFallback);

        JSFunction* cleanup = globalObject->mockModule.withImplementationCleanupFunction.getInitializedOnMainThread(globalObject);
        JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
        auto callData = JSC::getCallData(performPromiseThenFunction);
        MarkedArgumentBuffer arguments;
        arguments.append(promise);
        arguments.append(cleanup);
        arguments.append(cleanup);
        arguments.append(capability);
        arguments.append(ctx);
        ASSERT(!arguments.hasOverflowed());
        call(globalObject, performPromiseThenFunction, callData, jsUndefined(), arguments);
        RETURN_IF_EXCEPTION(scope, {});

        return JSC::JSValue::encode(promise);
    }

    thisObject->setImplementations(globalObject, lastImpl, lastTail, lastFallback);
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(thisObject->isVitest ? JSValue(thisObject) : jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsAutomockedAccessor, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    return JSValue::encode(jsUndefined());
}

enum class AutomockKind : uint8_t {
    Keep,
    Array,
    Object,
    Module,
    Function,
};

enum class AutomockRole : uint8_t {
    Member,
    Exports,
    Prototype,
};

struct Automocker {
    Zig::GlobalObject* globalObject;
    bool spy;
    bool leaveOriginalAlone;
    JSC::JSMap* replacements;
    // Work list of (original, replacement, AutomockKind) triples.
    JSC::MarkedArgumentBuffer pending {};
    JSC::JSFunction* accessor { nullptr };

    AutomockKind kindOf(JSValue);
    JSValue replacementFor(JSValue, AutomockRole = AutomockRole::Member);
    void mockElements(JSObject* original, JSC::JSArray* replacement);
    void mockMembers(JSObject* original, JSObject* replacement, AutomockKind);
};

// JSC inlines all 5 KB of objectPrototypeToString() into every caller.
__attribute__((minsize)) NEVER_INLINE JSString* objectPrototypeToStringOutOfLine(JSGlobalObject* globalObject, JSValue value)
{
    return JSC::objectPrototypeToString(globalObject, value);
}

AutomockKind Automocker::kindOf(JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (!value.isObject() || dynamicDowncast<JSMockFunction>(value))
        return AutomockKind::Keep;
    // A global object has no Symbol.toStringTag that would make the check below keep it.
    if (asObject(value)->isGlobalObject() || asObject(value)->type() == JSC::GlobalProxyType)
        return AutomockKind::Keep;

    bool isArray = JSC::isArray(globalObject, value);
    RETURN_IF_EXCEPTION(scope, AutomockKind::Keep);
    if (isArray)
        return AutomockKind::Array;

    // Goes by Object.prototype.toString(), so a Map, Date, Promise or instance with a Symbol.toStringTag is kept as it is.
    JSString* tag = objectPrototypeToStringOutOfLine(globalObject, value);
    if (scope.exception()) [[unlikely]] {
        // A Symbol.toStringTag getter may throw when it's read on the prototype itself. Treat that as no tag.
        if (!scope.tryClearException())
            return AutomockKind::Keep;
        tag = std::get<JSString*>(JSC::inferBuiltinTag(globalObject, asObject(value)));
        RETURN_IF_EXCEPTION(scope, AutomockKind::Keep);
    }
    auto tagView = tag->view(globalObject);
    RETURN_IF_EXCEPTION(scope, AutomockKind::Keep);

    if (tagView.data == "[object Object]"_s)
        return AutomockKind::Object;
    if (tagView.data == "[object Module]"_s)
        return AutomockKind::Module;
    if (value.isCallable() && tagView->contains("Function"_s))
        return AutomockKind::Function;
    return AutomockKind::Keep;
}

__attribute__((minsize)) JSValue Automocker::replacementFor(JSValue value, AutomockRole role)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!value.isObject())
        return value;

    JSValue known = replacements->get(globalObject, value);
    RETURN_IF_EXCEPTION(scope, {});
    if (!known.isUndefined())
        return known;

    AutomockKind kind = kindOf(value);
    RETURN_IF_EXCEPTION(scope, {});

    JSObject* original = asObject(value);
    JSObject* replacement = nullptr;
    switch (kind) {
    case AutomockKind::Keep:
        return value;
    case AutomockKind::Array:
        replacement = JSC::constructEmptyArray(globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        break;
    case AutomockKind::Object: {
        // Spy in place, so that spied methods still find the private fields, internal slots and prototype of their `this`.
        bool inPlace = spy;
        if (spy && leaveOriginalAlone && role == AutomockRole::Prototype) {
            replacement = JSC::constructEmptyObject(globalObject, original);
            break;
        }
        if (role == AutomockRole::Exports || (spy && leaveOriginalAlone)) {
            JSValue prototype = original->getPrototype(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (!prototype.isObject() || prototype == globalObject->objectPrototype()) {
                inPlace = false;
                if (role == AutomockRole::Exports)
                    kind = AutomockKind::Module;
            } else if (spy && leaveOriginalAlone) {
                return value;
            }
        }
        replacement = inPlace ? original : JSC::constructEmptyObject(globalObject);
        break;
    }
    case AutomockKind::Module:
        replacement = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
        replacement->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsNontrivialString(vm, "Module"_s), static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
        break;
    case AutomockKind::Function: {
        auto* mock = createMockFunction(vm, globalObject, true);
        mock->isAutomock = true;
        mock->copyNameAndLength(vm, globalObject, value);
        RETURN_IF_EXCEPTION(scope, {});
        if (spy) {
            mock->setInitialImplementation(globalObject, value);
            RETURN_IF_EXCEPTION(scope, {});
        }
        replacement = mock;
        break;
    }
    }

    JSC__JSMap__set(replacements, globalObject, JSValue::encode(value), JSValue::encode(replacement));
    RETURN_IF_EXCEPTION(scope, {});

    if (kind != AutomockKind::Array || spy) {
        pending.append(original);
        pending.append(replacement);
        pending.append(jsNumber(static_cast<uint8_t>(kind)));
        if (pending.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
    }
    return replacement;
}

void Automocker::mockElements(JSObject* original, JSC::JSArray* replacement)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue lengthValue = original->get(globalObject, vm.propertyNames->length);
    RETURN_IF_EXCEPTION(scope, );
    unsigned length = lengthValue.toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, );

    forEachElement(globalObject, original, length, [&](unsigned i) {
        JSC::PropertySlot slot(original, JSC::PropertySlot::InternalMethodType::Get);
        bool found = original->getPropertySlot(globalObject, i, slot);
        if (scope.exception() || !found)
            return;
        JSValue element = slot.getValue(globalObject, i);
        if (scope.exception())
            return;
        JSValue mocked = replacementFor(element);
        if (scope.exception())
            return;
        replacement->putDirectIndex(globalObject, i, mocked);
    });
    RETURN_IF_EXCEPTION(scope, );

    scope.release();
    replacement->setLength(globalObject, length, true);
}

void Automocker::mockMembers(JSObject* original, JSObject* replacement, AutomockKind kind)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // A transpiled module (`__esModule`) exports through getters, so those are read. No other getter is called.
    bool isModule = kind == AutomockKind::Module;
    if (!isModule) {
        JSValue esModule = original->get(globalObject, vm.propertyNames->__esModule);
        RETURN_IF_EXCEPTION(scope, );
        isModule = esModule.toBoolean(globalObject);
    }
    bool isFunction = kind == AutomockKind::Function;
    bool inPlace = original == replacement;

    // One builder for the whole prototype chain, so a key that a closer holder shadows isn't added twice.
    JSC::PropertyNameArrayBuilder keys(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    JSObject* holder = original;
    while (holder != globalObject->objectPrototype() && holder != globalObject->functionPrototype() && holder != globalObject->regExpPrototype()) {
        size_t firstKey = keys.size();
        holder->methodTable()->getOwnPropertyNames(holder, globalObject, keys, JSC::DontEnumPropertiesMode::Include);
        RETURN_IF_EXCEPTION(scope, );

        for (size_t i = firstKey; i < keys.size(); ++i) {
            Identifier key = keys[i];
            if (isFunction && (key == vm.propertyNames->length || key == vm.propertyNames->name || key == vm.propertyNames->arguments || key == vm.propertyNames->caller))
                continue;
            if (kind == AutomockKind::Module && key == vm.propertyNames->toStringTagSymbol)
                continue;

            JSC::PropertyDescriptor descriptor;
            bool found = holder->getOwnPropertyDescriptor(globalObject, key, descriptor);
            RETURN_IF_EXCEPTION(scope, );
            if (!found)
                continue;

            JSValue value;
            if (descriptor.isDataDescriptor()) {
                value = descriptor.value();
            } else if (isModule || !descriptor.getter().isObject()) {
                value = original->get(globalObject, key);
                RETURN_IF_EXCEPTION(scope, );
            } else {
                if (inPlace)
                    continue;
                if (!spy && !accessor)
                    accessor = JSC::JSFunction::create(vm, globalObject, 0, String(), jsAutomockedAccessor, ImplementationVisibility::Public);
                if (!spy) {
                    descriptor.setGetter(accessor);
                    if (descriptor.setter().isObject())
                        descriptor.setSetter(accessor);
                }
                putOwnProperty(globalObject, replacement, key, descriptor);
                RETURN_IF_EXCEPTION(scope, );
                continue;
            }

            JSValue mocked = replacementFor(value, isFunction && key == vm.propertyNames->prototype ? AutomockRole::Prototype : AutomockRole::Member);
            RETURN_IF_EXCEPTION(scope, );

            if (inPlace) {
                if (mocked == value)
                    continue;
                JSC::PutPropertySlot slot(replacement);
                replacement->methodTable()->put(replacement, globalObject, key, mocked, slot);
            } else if (isFunction && key == vm.propertyNames->prototype) {
                uncheckedDowncast<JSMockFunction>(replacement)->setPrototypeProperty(vm, mocked);
            } else {
                replacement->putDirectMayBeIndex(globalObject, key, mocked);
            }
            RETURN_IF_EXCEPTION(scope, );
        }

        // A module namespace object's prototype only exists to serve `__esModule` to CommonJS interop.
        if (kind == AutomockKind::Module)
            break;
        JSValue next = holder->getPrototype(globalObject);
        RETURN_IF_EXCEPTION(scope, );
        if (!next.isObject())
            break;
        holder = asObject(next);
    }
}

__attribute__((minsize)) static JSValue automock(Zig::GlobalObject* globalObject, JSValue value, AutomockRole role, bool spy, bool leaveOriginalAlone)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    Automocker automocker { globalObject, spy, leaveOriginalAlone, JSC::JSMap::create(vm, globalObject->mapStructure()) };
    JSValue result = automocker.replacementFor(value, role);
    RETURN_IF_EXCEPTION(scope, {});

    while (automocker.pending.size()) {
        auto kind = static_cast<AutomockKind>(automocker.pending.takeLast().asInt32());
        JSObject* replacement = asObject(automocker.pending.takeLast());
        JSObject* original = asObject(automocker.pending.takeLast());
        if (kind == AutomockKind::Array)
            automocker.mockElements(original, uncheckedDowncast<JSC::JSArray>(replacement));
        else
            automocker.mockMembers(original, replacement, kind);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return result;
}

JSC::JSValue mockObject(Zig::GlobalObject* globalObject, JSC::JSValue value, bool spy, bool leaveOriginalAlone)
{
    return automock(globalObject, value, AutomockRole::Exports, spy, leaveOriginalAlone);
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMockObject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue options = callframe->argument(1);
    bool spy = false;
    if (options.isObject()) {
        JSValue spyValue = asObject(options)->get(globalObject, Identifier::fromString(vm, "spy"_s));
        RETURN_IF_EXCEPTION(scope, {});
        spy = spyValue.toBoolean(globalObject);
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(automock(globalObject, callframe->argument(0), AutomockRole::Member, spy, false)));
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionIsMockFunction, (JSC::JSGlobalObject*, JSC::CallFrame* callframe))
{
    return JSValue::encode(jsBoolean(!!dynamicDowncast<JSMockFunction>(callframe->argument(0))));
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionMocked, (JSC::JSGlobalObject*, JSC::CallFrame* callframe))
{
    return JSValue::encode(callframe->argument(0));
}

} // namespace Bun

using namespace Bun;
using namespace JSC;

// Helper function for native code to set the overriden Date.now() time
extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__setOverridenDateNow(JSC::JSGlobalObject* globalObject, double time_ms)
{
    globalObject->overridenDateNow = time_ms;
}

// Helper function for native code to get the current Unix epoch time in milliseconds
extern "C" [[ZIG_EXPORT(nothrow)]] double JSMock__getCurrentUnixTimeMs()
{
    return WTF::WallTime::now().secondsSinceEpoch().milliseconds();
}

// Calling a host function through a bare identifier passes the scope it was found in as `this`, which must never reach script.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSMock__strictThis(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue thisValue)
{
    return JSValue::encode(JSValue::decode(thisValue).toThis(globalObject, ECMAMode::strict()));
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsNow, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(jsNumber(globalObject->jsDateNow()));
}

extern "C" void Bun__FakeTimers__setSystemTime(JSC::JSGlobalObject* globalObject, double ms);

extern "C" bool JSMock__isRestoredSpy(JSC::EncodedJSValue value)
{
    auto* mock = dynamicDowncast<JSMockFunction>(JSValue::decode(value));
    return mock && mock->isRestoredSpy();
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsSetSystemTime, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue argument0 = callframe->argument(0);

    // JSGlobalObject::overridenDateNow's "no override" sentinel is NaN (see
    // JSGlobalObject::jsDateNow()), so every real timestamp, including 0 and
    // pre-epoch negatives, overrides; an omitted arg, NaN, or invalid Date resets.
    double ms;
    if (auto* dateInstance = dynamicDowncast<DateInstance>(argument0)) {
        ms = dateInstance->internalNumber();
    } else if (argument0.isString()) {
        auto dateString = argument0.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        ms = WTF::timeClip(vm.dateCache.parseDate(globalObject, vm, dateString));
        RETURN_IF_EXCEPTION(scope, {});
        if (std::isnan(ms)) {
            return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, makeString("setSystemTime() expects a finite number, a Date or a date string. Received \""_s, dateString, '"'));
        }
    } else {
        ms = argument0.isNumber() ? argument0.asNumber() : PNaN;
    }
    if (std::isinf(ms)) {
        return Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, makeString("setSystemTime() expects a finite number, a Date or a date string. Received "_s, ms > 0 ? "Infinity"_s : "-Infinity"_s));
    }
    globalObject->overridenDateNow = ms;
    // Rebase the Rust-side fake-timers offset so advanceTimersByTime ticks
    // from this value instead of the activation-time clock.
    Bun__FakeTimers__setSystemTime(globalObject, ms);

    return JSMock__strictThis(globalObject, JSValue::encode(callframe->thisValue()));
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsRestoreAllMocks, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSMock__restoreAllMocks(uncheckedDowncast<Zig::GlobalObject>(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    return JSMock__strictThis(globalObject, JSValue::encode(callframe->thisValue()));
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsClearAllMocks, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSMock__clearAllMocks(uncheckedDowncast<Zig::GlobalObject>(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    return JSMock__strictThis(globalObject, JSValue::encode(callframe->thisValue()));
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsResetAllMocks, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSMock__resetAllMocks(uncheckedDowncast<Zig::GlobalObject>(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    return JSMock__strictThis(globalObject, JSValue::encode(callframe->thisValue()));
}

__attribute__((minsize)) static void wrapFunction(Zig::GlobalObject* globalObject, JSMockFunction* mock, JSValue function, JSString* name = nullptr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (name) {
        mock->copyLength(vm, globalObject, function);
        RETURN_IF_EXCEPTION(scope, );
        mock->setName(name);
    } else {
        mock->copyNameAndLength(vm, globalObject, function);
        RETURN_IF_EXCEPTION(scope, );
    }
    mock->copyStaticProperties(globalObject, asObject(function));
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    if (!mock->isVitest) {
        mock->pushImpl(globalObject, JSMockImplementation::Kind::Call, function);
        return;
    }
    mock->setInitialImplementation(globalObject, function);
}

static String propertyKeyForMessage(const Identifier& key)
{
    return key.isSymbol() ? makeString("Symbol("_s, key.string(), ')') : key.string();
}

static String propertyKeyForFunctionName(const Identifier& key)
{
    return key.isSymbol() ? makeString('[', key.string(), ']') : key.string();
}

static JSObject* findPropertyDescriptor(JSGlobalObject* globalObject, JSObject* object, PropertyName key, PropertyDescriptor& descriptor)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    for (JSObject* holder = object;;) {
        bool found = holder->getOwnPropertyDescriptor(globalObject, key, descriptor);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (found)
            return holder;
        JSValue prototype = holder->getPrototype(globalObject);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (!prototype.isObject())
            return nullptr;
        holder = asObject(prototype);
    }
}

enum class SpyAccess : uint8_t {
    Value,
    Get,
    Set,
};

__attribute__((minsize)) static JSC::EncodedJSValue spyOn(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, bool isVitest)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* globalObject = dynamicDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    if (!globalObject) [[unlikely]] {
        throwVMError(lexicalGlobalObject, scope, "Cannot run spyOn from a different global context"_s);
        return {};
    }

    JSValue objectValue = callframe->argument(0);
    JSValue propertyKeyValue = callframe->argument(1);
    JSValue accessTypeValue = callframe->argument(2);

    if (callframe->argumentCount() < 2 || !objectValue.isObject()) {
        throwVMError(globalObject, scope, "spyOn(target, prop) expects a target object and a property key"_s);
        return {};
    }

    Identifier propertyKey = propertyKeyValue.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (propertyKey.isNull()) {
        throwVMError(globalObject, scope, "spyOn(target, prop) expects a property key"_s);
        return {};
    }

    SpyAccess access = SpyAccess::Value;
    if (accessTypeValue.toBoolean(globalObject)) {
        if (accessTypeValue.isString()) {
            auto accessType = asString(accessTypeValue)->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (accessType.data == "get"_s)
                access = SpyAccess::Get;
            else if (accessType.data == "set"_s)
                access = SpyAccess::Set;
        }
        if (access == SpyAccess::Value) {
            throwTypeError(globalObject, scope, "spyOn(target, prop, accessType) expects accessType to be \"get\" or \"set\""_s);
            return {};
        }
    }

    JSC::JSObject* object = objectValue.getObject();
    if (object->type() == JSC::JSType::GlobalProxyType)
        object = uncheckedDowncast<JSC::JSGlobalProxy>(object)->target();

    // A node:vm global reads a key that the contextified object inherits from that object, but says it has no such key. So spy there.
    if (auto* contextGlobal = dynamicDowncast<NodeVMGlobalObject>(object)) {
        if (JSObject* contextified = contextGlobal->contextifiedObject()) {
            bool isOwn = contextified->hasOwnProperty(globalObject, propertyKey);
            RETURN_IF_EXCEPTION(scope, {});
            bool isInherited = !isOwn && contextified->hasProperty(globalObject, propertyKey);
            RETURN_IF_EXCEPTION(scope, {});
            if (isInherited)
                object = contextified;
        }
    }

    // In tests `import.meta.env` is backed by `process.env`, so spy there.
    if (object->structure()->typeInfo().prohibitsPropertyCaching()) [[unlikely]] {
        if (JSObject* env = processEnvOfImportMetaEnvForTests(globalObject, object))
            object = env;
        RETURN_IF_EXCEPTION(scope, {});
    }

    // A module mock's exports are read live from the object its factory returned, so spy on that object.
    while (auto* moduleNamespaceObject = dynamicDowncast<JSModuleNamespaceObject>(object)) {
        JSObject* exports = Bun::objectHoldingExportOfModuleMock(globalObject, moduleNamespaceObject, propertyKey);
        RETURN_IF_EXCEPTION(scope, {});
        if (!exports)
            break;
        object = exports;
    }

    if (auto* target = dynamicDowncast<JSMockFunction>(object); target && propertyKey == vm.propertyNames->prototype) {
        target->prototypeProperty(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::HasProperty);
    bool hasValue = object->getPropertySlot(globalObject, propertyKey, slot);
    RETURN_IF_EXCEPTION(scope, {});
    // A String object's indices and `length` are own properties, but come without a slotBase().
    bool isOwn = hasValue && (!slot.slotBase() || slot.slotBase() == object);
    unsigned slotAttributes = hasValue ? slot.attributes() : 0;
    bool isEasy = access == SpyAccess::Value && (!hasValue || slot.isValue());

    PropertyDescriptor descriptor;
    bool isOpaque = isOpaqueProperty(globalObject, object, propertyKey);
    RETURN_IF_EXCEPTION(scope, {});
    if (hasValue && (!isEasy || isOpaque)) {
        JSObject* holder = findPropertyDescriptor(globalObject, object, propertyKey, descriptor);
        RETURN_IF_EXCEPTION(scope, {});
        // An opaque property's slot only says that the property exists, so go by the descriptor.
        if (isOpaque) {
            isOwn = holder == object;
            slotAttributes = descriptor.attributes() & descriptorAttributes;
            isEasy = access == SpyAccess::Value && descriptor.isDataDescriptor();
        }
    }

    // easymode: regular property or missing property
    if (isEasy) {
        JSValue value = jsUndefined();
        if (hasValue) {
            if (slot.isTaintedByOpaqueObject()) [[unlikely]] {
                // if it's a Proxy or JSModuleNamespaceObject
                value = object->get(globalObject, propertyKey);
                RETURN_IF_EXCEPTION(scope, {});
            } else {
                value = slot.getValue(globalObject, propertyKey);
                RETURN_IF_EXCEPTION(scope, {});
            }

            if (dynamicDowncast<JSMockFunction>(value)) {
                return JSValue::encode(value);
            }
        }

        auto* moduleNamespaceObject = dynamicDowncast<JSModuleNamespaceObject>(object);
        if (moduleNamespaceObject && !hasValue) {
            throwTypeError(globalObject, scope, makeString("spyOn(target, prop) expects the module namespace object to export `"_s, propertyKeyForMessage(propertyKey), '`'));
            return {};
        }

        auto* mock = createMockFunction(vm, globalObject, isVitest);
        unsigned spyAttributes = slotAttributes;
        // A spy that shadows an inherited property is deleted on restore, so it has to be configurable.
        unsigned attributes = isOwn ? spyAttributes : spyAttributes & ~PropertyAttribute::DontDelete;
        if (moduleNamespaceObject)
            spyAttributes |= JSMockFunction::SpyAttributeESModuleNamespace;
        if (isOpaque)
            spyAttributes |= JSMockFunction::SpyAttributeOpaque;

        if (hasValue && ((slotAttributes & PropertyAttribute::Function) != 0 || (value.isCell() && value.isCallable()))) {
            wrapFunction(globalObject, mock, value);
            RETURN_IF_EXCEPTION(scope, {});

            if (moduleNamespaceObject) {
                moduleNamespaceObject->overrideExportValue(globalObject, propertyKey, mock);
            } else {
                putOwnPropertyStorage(globalObject, object, propertyKey, mock, attributes, isOpaque);
            }
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            // JSFunction::getOwnPropertySlot serves `prototype` straight from property storage, ignoring
            // the Accessor attribute, so a GetterSetter installed here would escape to script as a raw cell.
            if (propertyKey == vm.propertyNames->prototype && object->inherits<JSC::JSFunction>()) {
                throwVMError(globalObject, scope, "Cannot spy on the `prototype` property because it is not a function"_s);
                return {};
            }

            mock->pushImpl(globalObject, JSMockImplementation::Kind::ReturnValue, value);
            RETURN_IF_EXCEPTION(scope, {});

            if (moduleNamespaceObject) {
                moduleNamespaceObject->overrideExportValue(globalObject, propertyKey, mock);
            } else {
                putOwnPropertyStorage(globalObject, object, propertyKey, JSC::GetterSetter::create(vm, globalObject, mock, mock), attributes | PropertyAttribute::Accessor, isOpaque);
            }
            RETURN_IF_EXCEPTION(scope, {});
        }

        mock->didInstall(object, propertyKey, isOwn ? value : JSValue(), spyAttributes);
        return JSValue::encode(mock);
    }

    // hardmode: a property's getter or setter, or the method a getter returns
    if (!hasValue) {
        throwTypeError(globalObject, scope, makeString("spyOn(target, prop, accessType) expects target to have the property `"_s, propertyKeyForMessage(propertyKey), '`'));
        return {};
    }
    if (object->inherits<JSModuleNamespaceObject>()) {
        throwTypeError(globalObject, scope, makeString("Cannot spy on the "_s, access == SpyAccess::Get ? "getter"_s : "setter"_s, " of the `"_s, propertyKeyForMessage(propertyKey), "` export because the exports of a module namespace object are not accessors"_s));
        return {};
    }
    if (propertyKey == vm.propertyNames->prototype && object->inherits<JSC::JSFunction>()) {
        throwVMError(globalObject, scope, "Cannot spy on the `prototype` property because it is not a function"_s);
        return {};
    }

    JSValue getter = descriptor.isAccessorDescriptor() ? descriptor.getter() : jsUndefined();
    JSValue setter = descriptor.isAccessorDescriptor() ? descriptor.setter() : jsUndefined();

    JSValue original = access == SpyAccess::Set ? setter : getter;
    // One mock as both getter and setter is the spy easymode installs for a non-function value. It's returned as is below.
    if (access == SpyAccess::Value && !(getter == setter && dynamicDowncast<JSMockFunction>(getter))) {
        original = object->get(globalObject, propertyKey);
        RETURN_IF_EXCEPTION(scope, {});
        if (!original.isCallable()) {
            JSString* type = original.isNull() ? vm.smallStrings.nullString() : jsTypeStringForValue(globalObject, original);
            auto typeView = type->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            throwTypeError(globalObject, scope, makeString("Cannot spy on the `"_s, propertyKeyForMessage(propertyKey), "` property because it is not a function; "_s, typeView.data, " given instead"_s));
            return {};
        }
    }
    if (dynamicDowncast<JSMockFunction>(original)) {
        return JSValue::encode(original);
    }

    unsigned spyAttributes = 0;
    JSValue storage = getOwnPropertyStorage(globalObject, object, propertyKey, spyAttributes);
    RETURN_IF_EXCEPTION(scope, {});
    // The object itself answers for an array's `length` or a typed array's elements, so an accessor in its storage would be ignored.
    if (storage && !isOpaque && (parseIndex(propertyKey) ? object->structure()->typeInfo().interceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero() : !object->getDirect(vm, propertyKey))) {
        throwTypeError(globalObject, scope, makeString("Cannot spy on the "_s, access == SpyAccess::Set ? "setter"_s : "getter"_s, " of the `"_s, propertyKeyForMessage(propertyKey), "` property because it cannot be redefined"_s));
        return {};
    }

    auto* mock = createMockFunction(vm, globalObject, isVitest);
    if (original.isCallable()) {
        wrapFunction(globalObject, mock, original);
    } else if (access == SpyAccess::Get && descriptor.isDataDescriptor()) {
        mock->pushImpl(globalObject, JSMockImplementation::Kind::ReturnValue, descriptor.value());
    }
    RETURN_IF_EXCEPTION(scope, {});

    switch (access) {
    case SpyAccess::Value: {
        auto* returnThis = JSC::JSFunction::create(vm, globalObject, 0, String(), jsMockFunctionReturnThis, ImplementationVisibility::Public);
        getter = JSC::JSBoundFunction::create(vm, globalObject, returnThis, mock, ArgList(), 0, nullptr, makeSource(String(), SourceOrigin(), SourceTaintedOrigin::Untainted));
        RETURN_IF_EXCEPTION(scope, {});
        break;
    }
    case SpyAccess::Get:
        mock->setName(makeString("get "_s, propertyKeyForFunctionName(propertyKey)));
        getter = mock;
        break;
    case SpyAccess::Set:
        mock->setName(makeString("set "_s, propertyKeyForFunctionName(propertyKey)));
        setter = mock;
        break;
    }

    // Always configurable, so that restoring can delete or redefine it.
    putOwnPropertyStorage(globalObject, object, propertyKey, JSC::GetterSetter::create(vm, globalObject, getter, setter), PropertyAttribute::Accessor | (descriptor.attributes() & PropertyAttribute::DontEnum), isOpaque);
    RETURN_IF_EXCEPTION(scope, {});

    mock->didInstall(object, propertyKey, storage, spyAttributes | JSMockFunction::SpyAttributeAccessor | (isOpaque ? JSMockFunction::SpyAttributeOpaque : 0));
    return JSValue::encode(mock);
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsSpyOn, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return spyOn(globalObject, callframe, false);
}

JSC_DEFINE_HOST_FUNCTION(jsVitestSpyOn, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return spyOn(globalObject, callframe, true);
}

static JSC::EncodedJSValue mockFn(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, bool isVitest)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (isVitest && dynamicDowncast<JSMockFunction>(callframe->argument(0)))
        return JSValue::encode(callframe->argument(0));

    JSMockFunction* thisObject = createMockFunction(vm, globalObject, isVitest);
    // Vitest names every vi.fn() "Mock", even one that wraps a named function.
    auto& name = isVitest ? globalObject->mockModule.vitestName : globalObject->mockModule.defaultName;

    if (callframe->argumentCount() > 0) {
        JSValue value = callframe->argument(0);
        if (value.isCallable()) {
            wrapFunction(globalObject, thisObject, value, isVitest ? name.getInitializedOnMainThread(globalObject) : nullptr);
        } else {
            // jest doesn't support doing `jest.fn(10)`, but we support it.
            thisObject->pushImpl(globalObject, JSMockImplementation::Kind::ReturnValue, value);
            thisObject->setName(name.getInitializedOnMainThread(globalObject));
        }
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        thisObject->setName(name.getInitializedOnMainThread(globalObject));
    }

    return JSValue::encode(thisObject);
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsMockFn, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return mockFn(globalObject, callframe, false);
}

JSC_DEFINE_HOST_FUNCTION(jsVitestFn, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return mockFn(globalObject, callframe, true);
}

static JSC::EncodedJSValue madeThroughJest(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue (*make)(JSC::JSGlobalObject*, JSC::CallFrame*, bool), JSC::CallFrame* callframe)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    JSValue mock = JSValue::decode(make(globalObject, callframe, false));
    RETURN_IF_EXCEPTION(scope, {});
    if (auto* made = dynamicDowncast<JSMockFunction>(mock); made && !made->isVitest)
        made->isJest = true;
    return JSValue::encode(mock);
}

JSC_DEFINE_HOST_FUNCTION(jsJestFn, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return madeThroughJest(globalObject, mockFn, callframe);
}

JSC_DEFINE_HOST_FUNCTION(jsJestSpyOn, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return madeThroughJest(globalObject, spyOn, callframe);
}

extern "C" void JSMock__putMockFunctionUtilities(Zig::GlobalObject* globalObject, JSC::EncodedJSValue encodedMockFn, JSC::EncodedJSValue encodedJest, JSC::EncodedJSValue encodedVi)
{
    auto& vm = JSC::getVM(globalObject);
    UNUSED_PARAM(encodedMockFn);
    JSObject* jest = JSValue::decode(encodedJest).getObject();
    JSObject* vi = JSValue::decode(encodedVi).getObject();

    auto* isMockFunction = JSC::JSFunction::create(vm, globalObject, 1, "isMockFunction"_s, jsMockFunctionIsMockFunction, ImplementationVisibility::Public);
    jest->putDirect(vm, Identifier::fromString(vm, "isMockFunction"_s), isMockFunction);
    vi->putDirect(vm, Identifier::fromString(vm, "isMockFunction"_s), isMockFunction);

    auto* mocked = JSC::JSFunction::create(vm, globalObject, 1, "mocked"_s, jsMockFunctionMocked, ImplementationVisibility::Public);
    jest->putDirect(vm, Identifier::fromString(vm, "mocked"_s), mocked);
    vi->putDirect(vm, Identifier::fromString(vm, "mocked"_s), mocked);

    vi->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "mockObject"_s), 1, jsMockFunctionMockObject, ImplementationVisibility::Public, NoIntrinsic, 0);

    vi->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "fn"_s), 1, jsVitestFn, ImplementationVisibility::Public, NoIntrinsic, 0);
    vi->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "spyOn"_s), 2, jsVitestSpyOn, ImplementationVisibility::Public, NoIntrinsic, 0);
    jest->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "fn"_s), 1, jsJestFn, ImplementationVisibility::Public, NoIntrinsic, 0);
    jest->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "spyOn"_s), 2, jsJestSpyOn, ImplementationVisibility::Public, NoIntrinsic, 0);
}

#undef CHECK_IS_MOCK_FUNCTION
