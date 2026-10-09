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
inline To tryJSDynamicCast(JSC::WriteBarrier<WriteBarrierT>& from)
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
}

DEFINE_VISIT_CHILDREN(JSMockImplementation);

const ClassInfo JSMockImplementation::s_info = { "MockImpl"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMockImplementation) };

// The value of an own data property, the GetterSetter or CustomGetterSetter cell of an own accessor, or empty.
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

// Like putDirect(), it ignores `writable` and `configurable`, unless `object` is a Proxy.
static void putOwnPropertyStorage(JSGlobalObject* globalObject, JSObject* object, PropertyName key, JSValue storage, unsigned attributes)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (object->type() == ProxyObjectType) {
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
        // putDirectCustomAccessor() asserts that the property is new
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
    putOwnPropertyStorage(globalObject, object, key, storage, descriptor.attributes() & descriptorAttributes);
}

class JSMockFunction;
static void setFallbackImplementation(JSMockFunction*, JSGlobalObject*, JSMockImplementation::Kind, JSValue);
static void addToMockSet(JSMockFunction*, JSC::WriteBarrier<JSC::Unknown>& set);

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
    // With `prototype` in it, which create() fills.
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

    JSC::LazyProperty<JSMockFunction, JSObject> mock;
    // three pointers to implementation objects
    // head of the list, this one is run next
    mutable JSC::WriteBarrier<JSC::Unknown> implementation;
    // this contains the non-once implementation. there is only ever one of these
    mutable JSC::WriteBarrier<JSC::Unknown> fallbackImplmentation;
    // the last once implementation
    mutable JSC::WriteBarrier<JSC::Unknown> tail;
    // getOwnPropertyStorage() of the spied-on property: empty if the target inherited or lacked it
    mutable JSC::WriteBarrier<JSC::Unknown> spyOriginal;
    mutable JSC::WriteBarrier<JSC::JSArray> calls;
    mutable JSC::WriteBarrier<JSC::JSArray> contexts;
    mutable JSC::WriteBarrier<JSC::JSArray> invocationCallOrder;
    mutable JSC::WriteBarrier<JSC::JSArray> instances;
    mutable JSC::WriteBarrier<JSC::JSArray> returnValues;
    // of the mock an instance of an automocked class has for a method: the mock of that method on the class prototype
    mutable JSC::WriteBarrier<JSMockFunction> prototypeMock;
    // made by mockObject(): every instance gets its own mocks of the methods on `prototype`
    bool isAutomock { false };
    // made through `vi`, and behaves as Vitest's mocks do where those differ from Jest's
    bool isVitest { false };
    // what resetting a Vitest mock goes back to: the function given to vi.fn(), the original of a spy
    mutable JSC::WriteBarrier<JSC::Unknown> initialImplementation;
    // made through `jest`. Neither this nor isVitest: by mock() or spyOn() of "bun:test", whose mock name is its `name`
    bool isJest { false };
    // made by spyOn(): Vitest names it after the property
    bool isSpy { false };
    // `prototype` is still the CustomValue that all mocks share, which makes the object when it is read
    bool hasLazyPrototype { true };
    bool isInCalledMocks { false };
    bool isInConfiguredMocks { false };
    // While it loaded, or in a beforeAll() of it, which run once for all the test files: the end of a test file leaves it alone.
    bool isMadeByPreload { false };
    // what mockName() gave a mock of `jest` or `vi`, until it is reset
    mutable JSC::WriteBarrier<JSC::JSString> mockName;

    JSC::Weak<JSObject> spyTarget;
    JSC::Identifier spyIdentifier;
    unsigned spyAttributes = 0;

    static constexpr unsigned SpyAttributeESModuleNamespace = 1 << 30;
    // the spy is the getter or the setter of the property, or what its getter returns
    static constexpr unsigned SpyAttributeAccessor = 1 << 29;

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

    void didRecordCall()
    {
        if (!isInCalledMocks) [[unlikely]] {
            isInCalledMocks = true;
            addToMockSet(this, mockModule().calledMocks);
        }
    }

    void didConfigure()
    {
        if (!isInConfiguredMocks) {
            isInConfiguredMocks = true;
            addToMockSet(this, mockModule().configuredMocks);
        }
    }

    void copyNameAndLength(JSC::VM& vm, JSGlobalObject* global, JSC::JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(vm);
        WTF::String nameToUse;
        if (auto* fn = dynamicDowncast<JSFunction>(value)) {
            nameToUse = fn->name(vm);
            // `const f = () => {}` and `{ f: () => {} }` are only named this way
            if (nameToUse.isEmpty() && !fn->isHostFunction())
                nameToUse = fn->jsExecutable()->ecmaName().string();
            // `{ [symbol]() {} }` only has the property
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

    // Its structure lists its own keys, but for those three, which it makes when they are asked for.
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
                // promisify(mock) has to call the mock
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

    // getInstances(), which can throw, comes before the first read.
    void initMock()
    {
        mock.initLater(
            [](const JSC::LazyProperty<JSMockFunction, JSObject>::Initializer& init) {
                JSMockFunction* mock = init.owner;
                Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(mock->globalObject());
                JSC::Structure* structure = globalObject->mockModule.mockObjectStructure.getInitializedOnMainThread(globalObject);
                JSObject* object = JSC::constructEmptyObject(init.vm, structure);
                object->putDirectOffset(init.vm, 0, mock->getCalls());
                object->putDirectOffset(init.vm, 1, mock->getContexts());
                object->putDirectOffset(init.vm, 2, mock->instances.get());
                object->putDirectOffset(init.vm, 3, mock->getReturnValues());
                object->putDirectOffset(init.vm, 4, mock->getInvocationCallOrder());
                init.set(object);
            });
    }

    void clear()
    {
        this->calls.clear();
        this->instances.clear();
        this->returnValues.clear();
        this->contexts.clear();
        this->invocationCallOrder.clear();

        if (!this->mock.isInitialized())
            return;
        if (!this->isVitest) {
            this->initMock();
            return;
        }

        // In Vitest `fn.mock` stays the same object.
        auto& vm = this->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSObject* state = this->mock.getInitializedOnMainThread(this);
        JSArray* instances = this->getInstances();
        RETURN_IF_EXCEPTION(scope, );
        // in the order of mockObjectStructure
        JSArray* arrays[] = { this->getCalls(), this->getContexts(), instances, this->getReturnValues(), this->getInvocationCallOrder() };
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

    // What mockReset() does besides mockClear().
    void resetConfiguration(JSGlobalObject* globalObject)
    {
        auto& vm = this->vm();
        this->tail.clear();
        this->mockName.clear();
        this->implementation.clear();
        JSValue initial = this->initialImplementation.get();
        if (!initial) {
            this->fallbackImplmentation.clear();
            this->updatePrototype(globalObject);
            return;
        }
        if (JSValue fallback = this->fallbackImplmentation.get())
            this->implementation.set(vm, this, fallback);
        setFallbackImplementation(this, globalObject, JSMockImplementation::Kind::Call, initial);
    }

    void reset(JSGlobalObject* globalObject)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        this->clear();
        RETURN_IF_EXCEPTION(scope, );
        RELEASE_AND_RETURN(scope, this->resetConfiguration(globalObject));
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

    // What script gets for `mock.prototype`, unless a spy has made that an accessor.
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

    // Instances are made from `mock.prototype`; the prototype of the function that constructs them goes behind it.
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
        auto* next = tryJSDynamicCast<JSMockImplementation*, Unknown>(this->implementation);
        this->setPrototypeParent(globalObject, next && next->kind == JSMockImplementation::Kind::Call ? next->underlyingValue.get() : JSValue());
    }

    bool isAccessorOf(GetterSetter* accessor)
    {
        if (accessor->getter() == this || accessor->setter() == this)
            return true;
        auto* getter = dynamicDowncast<JSBoundFunction>(accessor->getter());
        return getter && getter->boundThis() == this;
    }

    // Puts the spied-on property back as it was; that can throw (a module namespace export, an indexed slot).
    void clearSpy(JSGlobalObject* globalObject, bool shouldReset = true)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        if (shouldReset) {
            this->reset(globalObject);
            RETURN_IF_EXCEPTION(scope, );
        }

        if (auto* target = this->spyTarget.get()) {
            this->putBackOriginal(globalObject, target);
            // It can be tried again.
            RETURN_IF_EXCEPTION(scope, );
        }
        this->spyTarget.clear();
        this->spyOriginal.clear();
        this->spyIdentifier = JSC::Identifier();
        this->spyAttributes = 0;
    }

    void putBackOriginal(JSGlobalObject* globalObject, JSObject* target)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        JSValue original = this->spyOriginal.get();
        JSC::Identifier identifier = this->spyIdentifier;
        unsigned attributes = this->spyAttributes;

        if (attributes & SpyAttributeESModuleNamespace) {
            auto* moduleNamespaceObject = tryJSDynamicCast<JSModuleNamespaceObject*>(target);
            if (moduleNamespaceObject && original) {
                scope.release();
                moduleNamespaceObject->overrideExportValue(globalObject, identifier, original);
            }
            return;
        }

        if (attributes & SpyAttributeAccessor) {
            // Restoring the spy on the other half of the accessor already put both halves back.
            unsigned currentAttributes = 0;
            JSValue current = getOwnPropertyStorage(globalObject, target, identifier, currentAttributes);
            RETURN_IF_EXCEPTION(scope, );
            auto* accessor = tryJSDynamicCast<GetterSetter*>(current);
            if (!accessor || !this->isAccessorOf(accessor))
                return;
        }

        scope.release();
        if (original)
            putOwnPropertyStorage(globalObject, target, identifier, original, attributes & ~SpyAttributeAccessor);
        else
            JSCell::deleteProperty(target, globalObject, identifier);
    }

    JSArray* ensureState(JSC::WriteBarrier<JSC::JSArray>& state, const JSC::ArgList& values = JSC::ArgList()) const
    {
        JSArray* array = state.get();
        if (!array) {
            array = JSC::constructArray(globalObject(), globalObject()->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), values);
            state.set(vm(), this, array);
        }
        return array;
    }
    JSArray* getCalls() const { return ensureState(calls); }
    JSArray* getContexts() const { return ensureState(contexts); }
    JSArray* getReturnValues() const { return ensureState(returnValues); }
    JSArray* getInvocationCallOrder() const { return ensureState(invocationCallOrder); }
    // Not kept until `new` or script needs it: it would hold what `contexts` holds.
    JSArray* getInstances() const
    {
        auto scope = DECLARE_THROW_SCOPE(vm());
        MarkedArgumentBuffer values;
        JSArray* source = instances ? nullptr : contexts.get();
        for (unsigned i = 0; source && i < source->length(); ++i)
            values.append(source->canGetIndexQuickly(i) ? source->getIndexQuickly(i) : jsUndefined());
        if (values.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject(), scope);
            return {};
        }
        return ensureState(instances, values);
    }

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
        initMock();
    }
};

template<typename Visitor>
void JSMockFunction::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    JSMockFunction* fn = this;
    ASSERT_GC_OBJECT_INHERITS(fn, info());

    visitor.append(fn->implementation);
    visitor.append(fn->tail);
    visitor.append(fn->fallbackImplmentation);
    visitor.append(fn->calls);
    visitor.append(fn->contexts);
    visitor.append(fn->instances);
    visitor.append(fn->returnValues);
    visitor.append(fn->invocationCallOrder);
    visitor.append(fn->spyOriginal);
    visitor.append(fn->prototypeMock);
    visitor.append(fn->initialImplementation);
    visitor.append(fn->mockName);
    fn->mock.visit(visitor);
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

static NEVER_INLINE void addToMockSet(JSMockFunction* mock, JSC::WriteBarrier<JSC::Unknown>& set)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(mock->globalObject());
    auto& vm = JSC::getVM(globalObject);
    if (!set)
        set.set(vm, globalObject, ActiveSpySet::create(vm, globalObject->mockModule.activeSpySetStructure.getInitializedOnMainThread(globalObject)));
    uncheckedDowncast<ActiveSpySet>(set.get())->add(vm, mock, mock);
}

static void setFallbackImplementation(JSMockFunction* fn, JSGlobalObject* jsGlobalObject, JSMockImplementation::Kind kind, JSValue value)
{
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(jsGlobalObject);
    auto& vm = JSC::getVM(globalObject);

    if (auto* current = tryJSDynamicCast<JSMockImplementation*, Unknown>(fn->fallbackImplmentation)) {
        current->underlyingValue.set(vm, current, value);
        current->kind = kind;
        fn->updatePrototype(globalObject);
        return;
    }

    JSMockImplementation* impl = JSMockImplementation::create(globalObject, globalObject->mockModule.mockImplementationStructure.getInitializedOnMainThread(globalObject), kind, value, false);
    fn->fallbackImplmentation.set(vm, fn, impl);
    if (auto* tail = tryJSDynamicCast<JSMockImplementation*, Unknown>(fn->tail)) {
        tail->nextValueOrSentinel.set(vm, tail, impl);
    } else {
        fn->implementation.set(vm, fn, impl);
    }
    fn->updatePrototype(globalObject);
}

static void pushImpl(JSMockFunction* fn, JSGlobalObject* globalObject, JSMockImplementation::Kind kind, JSValue value)
{
    fn->didConfigure();
    setFallbackImplementation(fn, globalObject, kind, value);
}

static void pushImplOnce(JSMockFunction* fn, JSGlobalObject* jsGlobalObject, JSMockImplementation::Kind kind, JSValue value)
{
    Zig::GlobalObject* globalObject = uncheckedDowncast<Zig::GlobalObject>(jsGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    fn->didConfigure();

    JSMockImplementation* impl = JSMockImplementation::create(globalObject, globalObject->mockModule.mockImplementationStructure.getInitializedOnMainThread(globalObject), kind, value, true);

    if (!fn->implementation) {
        fn->implementation.set(vm, fn, impl);
    }
    if (auto* tail = tryJSDynamicCast<JSMockImplementation*, Unknown>(fn->tail)) {
        tail->nextValueOrSentinel.set(vm, tail, impl);
    } else {
        fn->implementation.set(vm, fn, impl);
    }
    if (auto fallback = fn->fallbackImplmentation.get()) {
        impl->nextValueOrSentinel.set(vm, impl, fallback);
    }
    fn->tail.set(vm, fn, impl);
    fn->updatePrototype(globalObject);
}

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

const ClassInfo JSMockFunctionPrototype::s_info = { "Mock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSMockFunctionPrototype) };

// Empties the set. It is weak: a mock that has been collected is not in it.
static void takeMocks(JSC::WriteBarrier<JSC::Unknown>& set, MarkedArgumentBuffer& mocks)
{
    if (JSValue value = set.get()) {
        uncheckedDowncast<ActiveSpySet>(value)->takeSnapshot(mocks);
        set.clear();
    }
}

// Goes on after an exception, and throws the first one once it is through.
template<typename Functor>
static void forEachMock(JSC::JSGlobalObject* globalObject, const MarkedArgumentBuffer& mocks, const Functor& apply)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::Exception* firstException = nullptr;
    for (size_t i = 0; i < mocks.size(); ++i) {
        apply(uncheckedDowncast<JSMockFunction>(mocks.at(i)));
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

static void clearCalledMock(JSMockFunction* mock)
{
    mock->isInCalledMocks = false;
    mock->clear();
}

static void restoreSpy(Zig::GlobalObject* globalObject, JSMockFunction* spy)
{
    // vi.restoreAllMocks() leaves the calls and the implementation of a spy as they are
    spy->clearSpy(globalObject, !spy->isVitest);
    bool didThrow = spy->spyTarget.get();
    if (didThrow)
        addToMockSet(spy, globalObject->mockModule.activeSpies);
}

extern "C" void JSMock__restoreAllMocks(Zig::GlobalObject* globalObject)
{
    MarkedArgumentBuffer spies;
    takeMocks(globalObject->mockModule.activeSpies, spies);
    forEachMock(globalObject, spies, [globalObject](JSMockFunction* spy) { restoreSpy(globalObject, spy); });
}

extern "C" void JSMock__clearAllMocks(Zig::GlobalObject* globalObject)
{
    MarkedArgumentBuffer mocks;
    takeMocks(globalObject->mockModule.calledMocks, mocks);
    forEachMock(globalObject, mocks, clearCalledMock);
}

extern "C" void JSMock__resetAllMocks(Zig::GlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSMock__clearAllMocks(globalObject);
    RETURN_IF_EXCEPTION(scope, );

    MarkedArgumentBuffer mocks;
    takeMocks(globalObject->mockModule.configuredMocks, mocks);
    scope.release();
    forEachMock(globalObject, mocks, [globalObject](JSMockFunction* mock) {
        mock->isInConfiguredMocks = false;
        mock->resetConfiguration(globalObject);
    });
}

template<typename Functor>
static void takeMocksOfTestFile(Zig::GlobalObject* globalObject, JSC::WriteBarrier<JSC::Unknown>& set, const Functor& apply)
{
    MarkedArgumentBuffer mocks;
    takeMocks(set, mocks);
    forEachMock(globalObject, mocks, [&](JSMockFunction* mock) {
        if (mock->isMadeByPreload)
            addToMockSet(mock, set);
        else
            apply(mock);
    });
}

// The next test file shares the global object: it gets neither the spies nor the calls of this one.
// It may share a module with it, though: what that has configured stays for resetAllMocks() to find.
extern "C" void JSMock__didFinishTestFile(Zig::GlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    takeMocksOfTestFile(globalObject, globalObject->mockModule.calledMocks, clearCalledMock);
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    takeMocksOfTestFile(globalObject, globalObject->mockModule.activeSpies, [globalObject](JSMockFunction* spy) { restoreSpy(globalObject, spy); });
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

// `result` has been in script's hands since createMockResult().
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
    JSC::JSArray* array = state.get();
    if (!array) {
        JSC::EncodedJSValue encodedValue = JSValue::encode(value);
        return fn->ensureState(state, JSC::ArgList(&encodedValue, 1));
    }
    array->push(globalObject, value);
    return array;
}

// Where `new` puts the instance once it exists.
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
    fn->didRecordCall();

    // Nothing but such an array, with room, takes an element without a chance for script to run.
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
        return scope.exception() ? nullptr : array;
    };

    if (invocationOfNew) {
        fn->getInstances();
        RETURN_IF_EXCEPTION(scope, );
    }
    if (!append(fn->calls, arguments))
        return;
    JSC::JSArray* contexts = append(fn->contexts, thisValue);
    if (!contexts)
        return;
    if (invocationOfNew) {
        invocationOfNew->contexts = contexts;
        invocationOfNew->contextIndex = contexts->length() - 1;
    }
    if (invocationOfNew || fn->instances) {
        JSC::JSArray* instances = append(fn->instances, thisValue);
        if (!instances)
            return;
        if (invocationOfNew) {
            invocationOfNew->instances = instances;
            invocationOfNew->instanceIndex = instances->length() - 1;
        }
    }
    if (!append(fn->invocationCallOrder, jsNumber(invocationId)))
        return;
    append(fn->returnValues, result);
}

static NEVER_INLINE void recordInvocationOutOfLine(Zig::GlobalObject* globalObject, JSMockFunction* fn, JSC::JSArray* arguments, JSC::JSValue thisValue, uint64_t invocationId, JSC::JSObject* result, MockInvocation* invocationOfNew)
{
    recordInvocation(globalObject, fn, arguments, thisValue, invocationId, result, invocationOfNew);
}

static JSMockImplementation* takeNextImplementation(JSC::VM& vm, JSMockFunction* fn)
{
    auto* impl = tryJSDynamicCast<JSMockImplementation*, Unknown>(fn->implementation);
    if (impl && impl->isOnce()) {
        auto next = impl->nextValueOrSentinel.get();
        fn->implementation.set(vm, fn, next);
        if (next.isNumber() || !dynamicDowncast<JSMockImplementation>(next)->isOnce()) {
            fn->tail.clear();
        }
    }
    return impl;
}

// Otherwise it cannot throw, or look at the "incomplete" result of the call it is in.
static ALWAYS_INLINE bool runsScriptOrThrows(JSMockImplementation* impl)
{
    return impl->kind == JSMockImplementation::Kind::Call || impl->kind == JSMockImplementation::Kind::ThrowValue;
}

static ALWAYS_INLINE JSC::JSValue valueOfMockImplementation(JSC::JSGlobalObject* globalObject, JSMockImplementation* impl, JSC::JSValue thisValue)
{
    switch (impl->kind) {
    case JSMockImplementation::Kind::ReturnValue:
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

// Of any kind: script that ran while the call was recorded may have configured the mock, which changes `impl` in place.
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

        // a subclass or the constructor may have put something else there
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
    JSMockImplementation* impl = takeNextImplementation(vm, fn);
    if (!impl && prototypeMock) [[unlikely]]
        impl = takeNextImplementation(vm, prototypeMock);

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
    JSMockImplementation* impl = takeNextImplementation(vm, fn);
    if (!impl && prototypeMock)
        impl = takeNextImplementation(vm, prototypeMock);

    JSValue constructor;
    if (impl && impl->kind == JSMockImplementation::Kind::Call)
        constructor = impl->underlyingValue.get();
    fn->setPrototypeParent(globalObject, constructor);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::CallData constructData;
    if (constructor)
        constructData = JSC::getConstructData(constructor);
    // Jest calls the implementation on the new object, which only a class refuses.
    if (!fn->isVitest && constructData.type == JSC::CallData::Type::JS && !constructData.js.functionExecutable->isClassConstructorFunction())
        constructData = {};
    bool constructs = constructData.type != JSC::CallData::Type::None;
    JSValue thisValue = jsUndefined();
    if (!constructs) {
        // An arrow function, a method, mockReturnValue(), nothing: do what `new` does with a plain function wrapping it.
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
    // In Jest the result of `new` is what the implementation returned, in Vitest the instance.
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

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionGetMockImplementation, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    JSValue thisValue = callframe->thisValue();
    JSMockFunction* thisObject = dynamicDowncast<JSMockFunction>(thisValue);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    CHECK_IS_MOCK_FUNCTION(thisValue);

    if (auto* implementation = tryJSDynamicCast<JSMockImplementation*, Unknown>(thisObject->implementation)) {
        if (implementation->kind == JSMockImplementation::Kind::Call) {
            RELEASE_AND_RETURN(scope, JSValue::encode(implementation->underlyingValue.get()));
        }
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_CUSTOM_GETTER(jsMockFunctionGetter_mock, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Bun::JSMockFunction* thisObject = dynamicDowncast<Bun::JSMockFunction>(JSValue::decode(thisValue));
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    CHECK_IS_MOCK_FUNCTION(JSValue::decode(thisValue))

    thisObject->getInstances();
    RETURN_IF_EXCEPTION(scope, {});
    // Script can write to what it gets here.
    thisObject->didRecordCall();
    return JSValue::encode(thisObject->mock.getInitializedOnMainThread(thisObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsMockFunctionGetter_prototype, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    // A CustomValue: `thisValue` is the object that holds the property.
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

    if (auto* impl = tryJSDynamicCast<JSMockImplementation*, Unknown>(thisObject->implementation)) {
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
        RELEASE_AND_RETURN(scope, JSValue::encode(mock->getCalls()));
    }
    return encodedJSUndefined();
}
extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSMockFunction__getReturns(JSC::JSGlobalObject* globalThis, EncodedJSValue encodedValue)
{
    auto scope = DECLARE_THROW_SCOPE(globalThis->vm());
    JSValue value = JSValue::decode(encodedValue);
    if (auto* mock = tryJSDynamicCast<JSMockFunction*>(value)) {
        RELEASE_AND_RETURN(scope, JSValue::encode(mock->getReturnValues()));
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
        auto* mockName = thisObject->mockName.get();
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
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::Call, value);
    } else {
        pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, jsUndefined());
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
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::Call, value);
    } else {
        pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, jsUndefined());
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
            thisObject->didConfigure();
            thisObject->mockName.set(vm, thisObject, asString(callframe->argument(0)));
        }
    } else if (callframe->argument(0).toBoolean(globalObject)) {
        JSString* name = callframe->argument(0).toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (thisObject->isJest) {
            thisObject->didConfigure();
            thisObject->mockName.set(vm, thisObject, name);
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

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnThis, jsUndefined());
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

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));
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

    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, callframe->argument(0));
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
    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, promise);
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
    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, promise);
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

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::RejectedValue, callframe->argument(0));
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

    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::RejectedValue, callframe->argument(0));
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

    pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ThrowValue, callframe->argument(0));
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

    pushImplOnce(thisObject, globalObject, JSMockImplementation::Kind::ThrowValue, callframe->argument(0));
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

// Every index below `length`, or, where the storage does not grow with the length, the ones that `array` has. Stops at an exception.
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

// Derived from `results`: what each returned promise has settled to by now.
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
    fn->didConfigure();
    fn->implementation.set(vm, fn, ctx->internalField(1).get());
    fn->tail.set(vm, fn, ctx->internalField(2).get());
    fn->fallbackImplmentation.set(vm, fn, ctx->internalField(3).get());
    fn->updatePrototype(jsGlobalObject);
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

    auto lastImpl = thisObject->implementation.get();
    auto lastTail = thisObject->tail.get();
    auto lastFallback = thisObject->fallbackImplmentation.get();

    JSMockImplementation* impl = JSMockImplementation::create(
        globalObject,
        globalObject->mockModule.mockImplementationStructure.getInitializedOnMainThread(globalObject),
        JSMockImplementation::Kind::Call,
        tempImplValue,
        false);

    thisObject->didConfigure();
    thisObject->implementation.set(vm, thisObject, impl);
    thisObject->fallbackImplmentation.clear();
    thisObject->tail.clear();
    thisObject->updatePrototype(globalObject);
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

    thisObject->didConfigure();
    thisObject->implementation.set(vm, thisObject, lastImpl);
    thisObject->tail.set(vm, thisObject, lastTail);
    thisObject->fallbackImplmentation.set(vm, thisObject, lastFallback);
    thisObject->updatePrototype(globalObject);
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
    // what a module exports: `module.exports`, or a module namespace object
    Exports,
    // the `prototype` of a function
    Prototype,
};

struct Automocker {
    Zig::GlobalObject* globalObject;
    bool spy;
    // nothing that can be reached from the original is written to
    bool leaveOriginalAlone;
    // original -> replacement: cycles end here and shared references stay shared
    JSC::JSMap* replacements;
    // (original, replacement, AutomockKind) triples whose members are still to be mocked
    JSC::MarkedArgumentBuffer pending {};
    JSC::JSFunction* accessor { nullptr };

    AutomockKind kindOf(JSValue);
    JSValue replacementFor(JSValue, AutomockRole = AutomockRole::Member);
    void mockElements(JSObject* original, JSC::JSArray* replacement);
    void mockMembers(JSObject* original, JSObject* replacement, AutomockKind);
};

// JSC inlines objectPrototypeToString whole, 5 KB, into every caller.
NEVER_INLINE JSString* objectPrototypeToStringOutOfLine(JSGlobalObject* globalObject, JSValue value)
{
    return JSC::objectPrototypeToString(globalObject, value);
}

AutomockKind Automocker::kindOf(JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (!value.isObject() || dynamicDowncast<JSMockFunction>(value))
        return AutomockKind::Keep;
    // it has no Symbol.toStringTag to be kept for
    if (asObject(value)->isGlobalObject() || asObject(value)->type() == JSC::GlobalProxyType)
        return AutomockKind::Keep;

    bool isArray = JSC::isArray(globalObject, value);
    RETURN_IF_EXCEPTION(scope, AutomockKind::Keep);
    if (isArray)
        return AutomockKind::Array;

    // Symbol.toStringTag counts: a Map, a Date, a Promise or a tagged class instance is kept as it is.
    JSString* tag = objectPrototypeToStringOutOfLine(globalObject, value);
    if (scope.exception()) [[unlikely]] {
        // The getter on a prototype throws when it needs an instance: as without a tag.
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

JSValue Automocker::replacementFor(JSValue value, AutomockRole role)
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
        // Spied methods have to find the private fields, internal slots and prototype of their `this`.
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
            mock->initialImplementation.set(vm, mock, value);
            setFallbackImplementation(mock, globalObject, JSMockImplementation::Kind::Call, value);
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

    // The exports of a transpiled module are getters; those are read, every other getter is left alone.
    bool isModule = kind == AutomockKind::Module;
    if (!isModule) {
        JSValue esModule = original->get(globalObject, vm.propertyNames->__esModule);
        RETURN_IF_EXCEPTION(scope, );
        isModule = esModule.toBoolean(globalObject);
    }
    bool isFunction = kind == AutomockKind::Function;
    bool inPlace = original == replacement;

    // One builder for the whole chain: a key an earlier holder had is not added again.
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

        // the prototype of a module namespace object only serves `__esModule` to CommonJS interop
        if (kind == AutomockKind::Module)
            break;
        JSValue next = holder->getPrototype(globalObject);
        RETURN_IF_EXCEPTION(scope, );
        if (!next.isObject())
            break;
        holder = asObject(next);
    }
}

static JSValue automock(Zig::GlobalObject* globalObject, JSValue value, AutomockRole role, bool spy, bool leaveOriginalAlone)
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

// A call of a bare identifier gives a host function the scope the identifier was found in as `this`. Script must never get hold of it.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSMock__strictThis(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue thisValue)
{
    return JSValue::encode(JSValue::decode(thisValue).toThis(globalObject, ECMAMode::strict()));
}

BUN_DEFINE_HOST_FUNCTION(JSMock__jsNow, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return JSValue::encode(jsNumber(globalObject->jsDateNow()));
}

extern "C" void Bun__FakeTimers__setSystemTime(JSC::JSGlobalObject* globalObject, double ms);

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

static void wrapFunction(Zig::GlobalObject* globalObject, JSMockFunction* mock, JSValue function)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    mock->copyNameAndLength(vm, globalObject, function);
    RETURN_IF_EXCEPTION(scope, );
    mock->copyStaticProperties(globalObject, asObject(function));
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    if (!mock->isVitest) {
        pushImpl(mock, globalObject, JSMockImplementation::Kind::Call, function);
        return;
    }
    // Resetting it changes nothing yet.
    mock->initialImplementation.set(vm, mock, function);
    setFallbackImplementation(mock, globalObject, JSMockImplementation::Kind::Call, function);
}

static void setSpyTarget(Zig::GlobalObject* globalObject, JSMockFunction* mock, JSObject* target, const Identifier& key, JSValue original, unsigned attributes)
{
    auto& vm = JSC::getVM(globalObject);

    mock->isSpy = true;
    mock->spyTarget = JSC::Weak<JSObject>(target, &weakValueHandleOwner(), nullptr);
    mock->spyIdentifier = key;
    mock->spyAttributes = attributes;
    if (original)
        mock->spyOriginal.set(vm, mock, original);
    addToMockSet(mock, globalObject->mockModule.activeSpies);
}

JSC_DEFINE_HOST_FUNCTION(jsMockFunctionSpiedMethodGetter, (JSC::JSGlobalObject*, JSC::CallFrame* callframe))
{
    return JSValue::encode(callframe->thisValue());
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

static JSC::EncodedJSValue spyOn(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callframe, bool isVitest)
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

    // An export of a module mock is a property of the object its factory returned.
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
    // the characters and the length of a String object come without a slot base
    bool isOwn = hasValue && (!slot.slotBase() || slot.slotBase() == object);
    unsigned slotAttributes = hasValue ? slot.attributes() : 0;
    bool isEasy = access == SpyAccess::Value && (!hasValue || slot.isValue());

    PropertyDescriptor descriptor;
    bool isProxy = object->type() == JSC::ProxyObjectType;
    if (hasValue && (!isEasy || isProxy)) {
        JSObject* holder = findPropertyDescriptor(globalObject, object, propertyKey, descriptor);
        RETURN_IF_EXCEPTION(scope, {});
        // all its slot says is that it has the property
        if (isProxy) {
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
        // restoring deletes a property that only shadows an inherited one
        unsigned attributes = isOwn ? spyAttributes : spyAttributes & ~PropertyAttribute::DontDelete;
        if (moduleNamespaceObject)
            spyAttributes |= JSMockFunction::SpyAttributeESModuleNamespace;

        if (hasValue && ((slotAttributes & PropertyAttribute::Function) != 0 || (value.isCell() && value.isCallable()))) {
            wrapFunction(globalObject, mock, value);
            RETURN_IF_EXCEPTION(scope, {});

            if (moduleNamespaceObject) {
                moduleNamespaceObject->overrideExportValue(globalObject, propertyKey, mock);
            } else {
                putOwnPropertyStorage(globalObject, object, propertyKey, mock, attributes);
            }
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            // JSFunction::getOwnPropertySlot serves `prototype` straight from property storage, ignoring
            // the Accessor attribute, so a GetterSetter installed here would escape to script as a raw cell.
            if (propertyKey == vm.propertyNames->prototype && object->inherits<JSC::JSFunction>()) {
                throwVMError(globalObject, scope, "Cannot spy on the `prototype` property because it is not a function"_s);
                return {};
            }

            pushImpl(mock, globalObject, JSMockImplementation::Kind::ReturnValue, value);
            RETURN_IF_EXCEPTION(scope, {});

            if (moduleNamespaceObject) {
                moduleNamespaceObject->overrideExportValue(globalObject, propertyKey, mock);
            } else {
                putOwnPropertyStorage(globalObject, object, propertyKey, JSC::GetterSetter::create(vm, globalObject, mock, mock), attributes | PropertyAttribute::Accessor);
            }
            RETURN_IF_EXCEPTION(scope, {});
        }

        setSpyTarget(globalObject, mock, object, propertyKey, isOwn ? value : JSValue(), spyAttributes);
        return JSValue::encode(mock);
    }

    // hardmode: the getter or the setter of a property, or the method a getter returns
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
    // a spy that is both halves is what easymode makes of a property that holds no function
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
    // The length of an array, the elements of a typed array: the object answers for those before it looks at its storage.
    if (storage && !isProxy && (parseIndex(propertyKey) ? object->structure()->typeInfo().interceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero() : !object->getDirect(vm, propertyKey))) {
        throwTypeError(globalObject, scope, makeString("Cannot spy on the "_s, access == SpyAccess::Set ? "setter"_s : "getter"_s, " of the `"_s, propertyKeyForMessage(propertyKey), "` property because it cannot be redefined"_s));
        return {};
    }

    auto* mock = createMockFunction(vm, globalObject, isVitest);
    if (original.isCallable()) {
        wrapFunction(globalObject, mock, original);
    } else if (access == SpyAccess::Get && descriptor.isDataDescriptor()) {
        pushImpl(mock, globalObject, JSMockImplementation::Kind::ReturnValue, descriptor.value());
    }
    RETURN_IF_EXCEPTION(scope, {});

    switch (access) {
    case SpyAccess::Value: {
        auto* returnThis = JSC::JSFunction::create(vm, globalObject, 0, String(), jsMockFunctionSpiedMethodGetter, ImplementationVisibility::Public);
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

    // configurable, whatever the original is: putOwnPropertyStorage() may have to delete it
    putOwnPropertyStorage(globalObject, object, propertyKey, JSC::GetterSetter::create(vm, globalObject, getter, setter), PropertyAttribute::Accessor | (descriptor.attributes() & PropertyAttribute::DontEnum));
    RETURN_IF_EXCEPTION(scope, {});

    setSpyTarget(globalObject, mock, object, propertyKey, storage, spyAttributes | JSMockFunction::SpyAttributeAccessor);
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

    if (callframe->argumentCount() > 0) {
        JSValue value = callframe->argument(0);
        if (value.isCallable()) {
            wrapFunction(globalObject, thisObject, value);
        } else {
            // jest doesn't support doing `jest.fn(10)`, but we support it.
            pushImpl(thisObject, globalObject, JSMockImplementation::Kind::ReturnValue, value);
            thisObject->setName(globalObject->mockModule.defaultName.getInitializedOnMainThread(globalObject));
        }
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        thisObject->setName(globalObject->mockModule.defaultName.getInitializedOnMainThread(globalObject));
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
