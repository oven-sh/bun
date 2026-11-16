#include "root.h"

#include "DesktopWindow.h"

#include "DesktopLazy.h"

#include "BunClientData.h"

#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/DeferGCInlines.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSGlobalProxyInlines.h>
#include <JavaScriptCore/ProxyObject.h>
#include <JavaScriptCore/StackVisitor.h>
#if ENABLE(AOT)
#include <JavaScriptCore/AOTCompiledFrame.h>
#include <JavaScriptCore/AOTFunctionDescription.h>
#endif

namespace Bun {

using namespace JSC;

static JSObject* delegateOf(JSCell* cell)
{
    VM& vm = cell->vm();
    JSValue delegate = asObject(cell)->getDirect(vm, WebCore::builtinNames(vm).hostPrivateName());
    return delegate ? delegate.getObject() : nullptr;
}

// Does what its `$host` does, once it has one.
template<typename Parent>
class Forwarder : public Parent {
public:
    using Base = Parent;
    using Parent::Parent;
    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertySlot | OverridesGetOwnPropertyNames | OverridesGetPrototype | OverridesPut | OverridesIsExtensible | InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero | ProhibitsPropertyCaching;

#define FORWARD(method, object, ...)                                   \
    if (JSObject* delegate = delegateOf(object))                       \
        return delegate->methodTable()->method(delegate, __VA_ARGS__); \
    return Base::method(object, __VA_ARGS__)

    static bool getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
    {
        if (name.isPrivateName())
            return Base::getOwnPropertySlot(object, globalObject, name, slot);
        FORWARD(getOwnPropertySlot, object, globalObject, name, slot);
    }
    static bool put(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot)
    {
        if (name.isPrivateName())
            return Base::put(cell, globalObject, name, value, slot);
        FORWARD(put, cell, globalObject, name, value, slot);
    }
    static bool getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot) { FORWARD(getOwnPropertySlotByIndex, object, globalObject, index, slot); }
    static bool putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow) { FORWARD(putByIndex, cell, globalObject, index, value, shouldThrow); }
    static bool deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, DeletePropertySlot& slot) { FORWARD(deleteProperty, cell, globalObject, name, slot); }
    static bool deletePropertyByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index) { FORWARD(deletePropertyByIndex, cell, globalObject, index); }
    static void getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode) { FORWARD(getOwnPropertyNames, object, globalObject, names, mode); }
    static bool defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName name, const PropertyDescriptor& descriptor, bool shouldThrow) { FORWARD(defineOwnProperty, object, globalObject, name, descriptor, shouldThrow); }
    static bool setPrototype(JSObject* object, JSGlobalObject* globalObject, JSValue prototype, bool shouldThrow) { FORWARD(setPrototype, object, globalObject, prototype, shouldThrow); }
    static JSValue getPrototype(JSObject* object, JSGlobalObject* globalObject) { FORWARD(getPrototype, object, globalObject); }
    static bool isExtensible(JSObject* object, JSGlobalObject* globalObject) { FORWARD(isExtensible, object, globalObject); }
    static bool preventExtensions(JSObject* object, JSGlobalObject* globalObject) { FORWARD(preventExtensions, object, globalObject); }
#undef FORWARD
};

// The target of a `JSGlobalProxy` has to be a global object. No code runs in this one.
class RemoteWindow final : public Forwarder<JSGlobalObject> {
public:
    using Base = Forwarder<JSGlobalObject>;
    DECLARE_INFO;

    static RemoteWindow* create(VM& vm, JSValue delegate)
    {
        DeferGC deferGC(vm);
        auto* structure = Structure::create(vm, nullptr, jsNull(), TypeInfo(GlobalObjectType, StructureFlags), info());
        structure->setTransitionWatchpointIsLikelyToBeFired(true);
        auto* window = new (NotNull, allocateCell<RemoteWindow>(vm)) RemoteWindow(vm, structure);
        window->finishCreation(vm);
        window->setPrototypeDirect(vm, jsNull());
        window->putDirect(vm, WebCore::builtinNames(vm).hostPrivateName(), delegate);
        return window;
    }

private:
    RemoteWindow(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};
static_assert(sizeof(RemoteWindow) == sizeof(JSGlobalObject));
const ClassInfo RemoteWindow::s_info = { "Object"_s, &JSGlobalObject::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RemoteWindow) };

// (delegate, windowProxy?): returns the window proxy, which now stands for `delegate`.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRemoteWindow, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto* window = RemoteWindow::create(vm, callFrame->uncheckedArgument(0));
    auto* proxy = dynamicDowncast<JSGlobalProxy>(callFrame->argument(1));
    if (proxy)
        proxy->setTarget(vm, window);
    else
        proxy = JSGlobalProxy::create(vm, JSGlobalProxy::createStructure(vm, window, jsNull()), window);
    window->addressOfGlobalThis()->set(vm, window, proxy);
    return JSValue::encode(proxy);
}

class PlainObject : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        static_assert(sizeof(CellType) == sizeof(JSNonFinalObject));
        return &vm.plainObjectSpace();
    }

    PlainObject(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename Class>
    static Class* create(JSGlobalObject* globalObject, JSValue prototype, JSValue delegate)
    {
        VM& vm = globalObject->vm();
        auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, Class::StructureFlags), Class::info());
        auto* object = new (NotNull, allocateCell<Class>(vm)) Class(vm, structure);
        object->finishCreation(vm);
        object->putDirect(vm, WebCore::builtinNames(vm).hostPrivateName(), delegate);
        return object;
    }
};

// https://webidl.spec.whatwg.org/#named-properties-object
class WindowProperties final : public PlainObject {
public:
    using Base = PlainObject;
    using Base::Base;
    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertySlot | GetOwnPropertySlotIsImpureForPropertyAbsence | IsImmutablePrototypeExoticObject;
    DECLARE_INFO;

    static bool getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
    {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (name.isSymbol())
            RELEASE_AND_RETURN(scope, Base::getOwnPropertySlot(object, globalObject, name, slot));
        bool isHidden = asObject(object->getPrototypeDirect())->hasProperty(globalObject, name);
        RETURN_IF_EXCEPTION(scope, false);
        if (isHidden)
            return false;
        slot.disableCaching();
        if (slot.isVMInquiry()) {
            slot.setIsTaintedByOpaqueObject();
            return false;
        }
        JSObject* find = delegateOf(object);
        MarkedArgumentBuffer arguments;
        arguments.append(jsString(vm, String(name.uid())));
        arguments.append(slot.thisValue());
        JSValue found = call(globalObject, find, JSC::getCallData(find), jsUndefined(), arguments);
        RETURN_IF_EXCEPTION(scope, false);
        if (found.isUndefined())
            return false;
        slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum), found);
        return true;
    }
    static bool defineOwnProperty(JSObject*, JSGlobalObject* globalObject, PropertyName, const PropertyDescriptor&, bool shouldThrow)
    {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        return typeError(globalObject, scope, shouldThrow, "Defining a property on a WindowProperties object is not allowed."_s);
    }
    static bool deleteProperty(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&) { return false; }
    static bool deletePropertyByIndex(JSCell*, JSGlobalObject*, unsigned) { return false; }
    static bool preventExtensions(JSObject*, JSGlobalObject*) { return false; }
};
const ClassInfo WindowProperties::s_info = { "WindowProperties"_s, &JSNonFinalObject::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(WindowProperties) };

// (find(name, receiver), prototype)
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopWindowProperties, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto* properties = PlainObject::create<WindowProperties>(globalObject, callFrame->uncheckedArgument(1), callFrame->uncheckedArgument(0));
    properties->putDirect(vm, vm.propertyNames->toStringTagSymbol, jsNontrivialString(vm, "WindowProperties"_s), PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
    return JSValue::encode(properties);
}

// Unlike a proxy, it has private names.
class Facade final : public Forwarder<PlainObject> {
public:
    using Base = Forwarder<PlainObject>;
    using Base::Base;
    DECLARE_INFO;
};
const ClassInfo Facade::s_info = { "Object"_s, &JSNonFinalObject::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(Facade) };

// (delegate, impl)
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopFacade, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto* facade = PlainObject::create<Facade>(globalObject, jsNull(), callFrame->uncheckedArgument(0));
    facade->putDirect(vm, WebCore::builtinNames(vm).implPrivateName(), callFrame->uncheckedArgument(1));
    return JSValue::encode(facade);
}

// (object): in place, without a structure for each property.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopMakeEnumerable, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    JSObject* object = asObject(callFrame->uncheckedArgument(0));
    const auto& names = *vm.propertyNames;
    Vector<std::pair<UniquedStringImpl*, unsigned>, 64> hidden;
    object->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) {
        auto* key = entry.key();
        bool isOfFunction = object->isCallable() && (key == names.name.impl() || key == names.length.impl() || key == names.prototype.impl());
        if ((entry.attributes() & PropertyAttribute::DontEnum) && !key->isSymbol() && key != names.constructor.impl() && !isOfFunction)
            hidden.append({ key, entry.attributes() & ~PropertyAttribute::DontEnum });
        return true;
    });
    if (hidden.isEmpty())
        return JSValue::encode(jsUndefined());
    ChangesInPlace inPlace(vm, object);
    for (auto [key, attributes] : hidden)
        Structure::attributeChangeTransition(vm, object->structure(), key, attributes);
    return JSValue::encode(jsUndefined());
}

// `document.all`
class Undetectable final : public Forwarder<PlainObject> {
public:
    using Base = Forwarder<PlainObject>;
    using Base::Base;
    static constexpr unsigned StructureFlags = Base::StructureFlags | MasqueradesAsUndefined | OverridesGetCallData;
    DECLARE_INFO;

    static CallData getCallData(JSCell*);
};
const ClassInfo Undetectable::s_info = { "Object"_s, &JSNonFinalObject::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(Undetectable) };

static JSC_DECLARE_HOST_FUNCTION(callUndetectable);
JSC_DEFINE_HOST_FUNCTION(callUndetectable, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    JSValue function = callFrame->jsCallee()->getDirect(vm, WebCore::builtinNames(vm).lazyLoaderPrivateName());
    return JSValue::encode(call(globalObject, function, getCallData(function), callFrame->jsCallee(), ArgList(callFrame)));
}

CallData Undetectable::getCallData(JSCell*)
{
    CallData callData;
    callData.type = CallData::Type::Native;
    callData.native.function = callUndetectable;
    callData.native.isBoundFunction = false;
    callData.native.isWasm = false;
    return callData;
}

// (delegate, call)
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopUndetectable, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    globalObject->masqueradesAsUndefinedWatchpointSet().fireAll(vm, "Allocated an undetectable object");
    auto* object = PlainObject::create<Undetectable>(globalObject, jsNull(), callFrame->uncheckedArgument(0));
    object->putDirect(vm, WebCore::builtinNames(vm).lazyLoaderPrivateName(), callFrame->uncheckedArgument(1));
    return JSValue::encode(object);
}

// (callback): the `$impl` of the global object of its realm.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopWindowOf, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    JSObject* object = asObject(callFrame->uncheckedArgument(0));
    while (true) {
        if (auto* bound = dynamicDowncast<JSBoundFunction>(object))
            object = bound->targetFunction();
        else if (auto* proxy = dynamicDowncast<ProxyObject>(object); proxy && !proxy->isRevoked())
            object = proxy->target();
        else
            break;
    }
    auto* realm = object->structure()->realm();
    JSValue impl = realm ? realm->getDirect(vm, WebCore::builtinNames(vm).implPrivateName()) : JSValue();
    return JSValue::encode(impl ? impl : jsUndefined());
}

static JSGlobalObject* realmOfScript(StackVisitor& visitor)
{
#if ENABLE(AOT)
    if (visitor->isCompiledFrame())
        return AOT::FunctionDescription(visitor->compiledFrame().function).isOfProgram() ? visitor->compiledFrame().globalObject() : nullptr;
#endif
    CodeBlock* codeBlock = visitor->codeBlock();
    return codeBlock && !codeBlock->unlinkedCodeBlock()->isBuiltinFunction() ? codeBlock->globalObject() : nullptr;
}

// (isEntry): the `$impl` of the global object of the innermost script on the stack, or of the outermost one.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopCallingWindow, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    bool isEntry = callFrame->argument(0).isTrue();
    JSValue found = jsUndefined();
    EntryFrame* entryFrame = nullptr;
    StackVisitor::visit(callFrame, vm, [&](StackVisitor& visitor) {
        JSGlobalObject* realm = realmOfScript(visitor);
        if (!realm)
            return IterationStatus::Continue;
        if (!found.isUndefined() && visitor->entryFrame() != entryFrame)
            return IterationStatus::Done;
        if (JSValue impl = realm->getDirect(vm, WebCore::builtinNames(vm).implPrivateName())) {
            found = impl;
            entryFrame = visitor->entryFrame();
        }
        return isEntry || found.isUndefined() ? IterationStatus::Continue : IterationStatus::Done;
    });
    return JSValue::encode(found);
}

} // namespace Bun
