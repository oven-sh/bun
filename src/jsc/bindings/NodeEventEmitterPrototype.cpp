#include "root.h"

#include "NodeEventEmitterPrototype.h"

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "InternalModuleRegistry.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/StructureCache.h>
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/Symbol.h>
#include <wtf/text/SymbolRegistry.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

// What a builtin that exists to create a function returns. Empty when the call threw.
static JSValue callFactory(VM& vm, JSGlobalObject* globalObject, FunctionExecutable* executable)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* factory = JSFunction::create(vm, globalObject, executable, globalObject);
    JSValue function = JSC::profiledCall(globalObject, ProfilingReason::API, factory, JSC::getCallData(factory), jsUndefined(), ArgList());
    RETURN_IF_EXCEPTION(scope, {});
    return function;
}

// The functions that the methods of EventEmitter.prototype call, by the private name that a method reads them under.
struct NodeEventsHelper {
    WebCore::BunBuiltinNames::Name name;
    FunctionExecutable* (*generator)(VM&);
};
static constexpr NodeEventsHelper nodeEventsHelpers[] = {
    { WebCore::BunBuiltinNames::Name::k_nodeEventsAddListener, WebCore::eventEmitterPrototypeInternalAddListenerCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsApplyHandlers, WebCore::eventEmitterPrototypeApplyHandlersCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsCopyWithInserted, WebCore::eventEmitterPrototypeCopyWithInsertedCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsEmitError, WebCore::eventEmitterPrototypeEmitErrorCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsOnceWrap, WebCore::eventEmitterPrototypeInternalOnceWrapCodeGenerator },
    { WebCore::BunBuiltinNames::Name::k_nodeEventsOverflowWarning, WebCore::eventEmitterPrototypeOverflowWarningCodeGenerator },
};

// Only a call into JS creates the `emit` that captures rejections, so its name is this getter until the first read.
JSC_DEFINE_CUSTOM_GETTER(getNodeEventsEmitWithRejectionCapture, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue, PropertyName name))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue emit = callFactory(vm, globalObject, WebCore::eventEmitterPrototypeCreateEmitWithRejectionCaptureCodeGenerator(vm));
    RETURN_IF_EXCEPTION(scope, {});
    globalObject->putDirect(vm, name, emit, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    return JSValue::encode(emit);
}

// The state of node:events that no emitter holds, and the helpers: one set per global, which the global object
// itself holds as own properties under private names. A builtin then reads one as a global variable, which the
// JITs fold to a constant; a field of a separate holder object would be loaded on every read.
static void putState(VM& vm, Zig::GlobalObject* globalObject)
{
    auto& names = WebCore::builtinNames(vm);
    if (globalObject->getDirect(vm, names.nodeEventsKCapturePrivateName()))
        return;

    constexpr unsigned constant = PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly;
    globalObject->putDirect(vm, names.nodeEventsDefaultMaxListenersPrivateName(), jsNumber(10), PropertyAttribute::DontEnum | PropertyAttribute::DontDelete);
    globalObject->putDirect(vm, names.nodeEventsKCapturePrivateName(), Symbol::createWithDescription(vm, "kCapture"_s), constant);
    globalObject->putDirect(vm, names.nodeEventsKShapeModePrivateName(), Symbol::createWithDescription(vm, "shapeMode"_s), constant);
    globalObject->putDirect(vm, names.nodeEventsKErrorMonitorPrivateName(), Symbol::create(vm, vm.symbolRegistry().symbolForKey("events.errorMonitor"_s)), constant);
    globalObject->putDirect(vm, names.nodeEventsKRejectionPrivateName(), Symbol::create(vm, vm.symbolRegistry().symbolForKey("nodejs.rejection"_s)), constant);

    // Functions from the start, which costs little: a builtin is not compiled before its first call. A getter that
    // its first read replaces with the function changes the attributes of a property of the global object. That
    // gives the global object a new Structure, and all optimized code that reads a global variable has to adapt to it.
    for (auto& helper : nodeEventsHelpers)
        globalObject->putDirectBuiltinFunction(vm, globalObject, names.privateName(helper.name), helper.generator(vm), constant);

    // The one name that has such a getter.
    constexpr unsigned lazy = PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomValue;
    globalObject->putDirectCustomAccessor(vm, names.nodeEventsEmitWithRejectionCapturePrivateName(), CustomGetterSetter::create(vm, getNodeEventsEmitWithRejectionCapture, nullptr), lazy);
}

JSValue nodeEventEmitterState(Zig::GlobalObject* globalObject, NodeEventEmitterState state)
{
    static constexpr WebCore::BunBuiltinNames::Name stateNames[] = {
        WebCore::BunBuiltinNames::Name::k_nodeEventsDefaultMaxListeners,
        WebCore::BunBuiltinNames::Name::k_nodeEventsKCapture,
        WebCore::BunBuiltinNames::Name::k_nodeEventsKShapeMode,
        WebCore::BunBuiltinNames::Name::k_nodeEventsKErrorMonitor,
        WebCore::BunBuiltinNames::Name::k_nodeEventsKRejection,
        WebCore::BunBuiltinNames::Name::k_nodeEventsEmitWithRejectionCapture,
    };
    auto index = static_cast<size_t>(state);
    ASSERT(index < std::size(stateNames));

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    putState(vm, globalObject);
    // Not getDirect(): the `emit` that captures rejections is behind its getter until something reads it.
    JSValue value = globalObject->get(globalObject, WebCore::builtinNames(vm).privateName(stateNames[index]));
    RETURN_IF_EXCEPTION(scope, {});
    return value;
}

// `on` is `addListener` and `off` is `removeListener`: reading either defines both, except a name that was assigned before.
static JSValue constructAliasedMethod(VM& vm, JSObject* prototype, FunctionExecutable* executable, ASCIILiteral name, ASCIILiteral alias)
{
    auto* globalObject = prototype->realm();
    auto* function = JSFunction::create(vm, globalObject, executable, globalObject);
    for (auto key : { name, alias }) {
        auto identifier = Identifier::fromString(vm, key);
        if (!isValidOffset(prototype->getDirectOffset(vm, identifier)))
            prototype->putDirect(vm, identifier, function);
    }
    return function;
}

static JSValue constructAddListener(VM& vm, JSObject* prototype)
{
    return constructAliasedMethod(vm, prototype, eventEmitterPrototypeAddListenerCodeGenerator(vm), "addListener"_s, "on"_s);
}

static JSValue constructRemoveListener(VM& vm, JSObject* prototype)
{
    return constructAliasedMethod(vm, prototype, eventEmitterPrototypeRemoveListenerCodeGenerator(vm), "removeListener"_s, "off"_s);
}

// Not PropertyCallbacks: those also run for a lookup that may not enter the VM, which a heap snapshot makes for `constructor`.
static JSC_DEFINE_CUSTOM_GETTER(nodeEventEmitterPrototypeLazyValue, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, PropertyName name))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue value;
    if (name == vm.propertyNames->constructor)
        value = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::Field::NodeEvents);
    else
        value = callFactory(vm, globalObject, eventEmitterPrototypeCreateEmitCodeGenerator(vm));
    RETURN_IF_EXCEPTION(scope, {});
    asObject(JSValue::decode(thisValue))->putDirect(vm, name, value);
    return JSValue::encode(value);
}

static JSC_DEFINE_CUSTOM_SETTER(setNodeEventEmitterPrototypeLazyValue, (JSGlobalObject * lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue value, PropertyName name))
{
    asObject(JSValue::decode(thisValue))->putDirect(JSC::getVM(lexicalGlobalObject), name, JSValue::decode(value));
    return true;
}

/* Source for NodeEventEmitterPrototype.lut.h
@begin eventEmitterPrototypeTable
    setMaxListeners      JSBuiltin                            Builtin|Function 1
    constructor          nodeEventEmitterPrototypeLazyValue   CustomValue
    getMaxListeners      JSBuiltin                            Builtin|Function 0
    emit                 nodeEventEmitterPrototypeLazyValue   CustomValue
    addListener          constructAddListener                 PropertyCallback
    on                   constructAddListener                 PropertyCallback
    prependListener      JSBuiltin                            Builtin|Function 2
    once                 JSBuiltin                            Builtin|Function 2
    prependOnceListener  JSBuiltin                            Builtin|Function 2
    removeListener       constructRemoveListener              PropertyCallback
    off                  constructRemoveListener              PropertyCallback
    removeAllListeners   JSBuiltin                            Builtin|Function 1
    listeners            JSBuiltin                            Builtin|Function 1
    rawListeners         JSBuiltin                            Builtin|Function 1
    listenerCount        JSBuiltin                            Builtin|Function 2
    eventNames           JSBuiltin                            Builtin|Function 0
@end
*/
#include "NodeEventEmitterPrototype.lut.h"

class NodeEventEmitterPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    static NodeEventEmitterPrototype* create(VM& vm, Structure* structure)
    {
        auto* prototype = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(NodeEventEmitterPrototype))) NodeEventEmitterPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeEventEmitterPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        auto* structure = Bun::createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    NodeEventEmitterPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};

// "Object" is the class name of the plain object that node:events had for a prototype.
const ClassInfo NodeEventEmitterPrototype::s_info = { "Object"_s, &Base::s_info, &eventEmitterPrototypeTable, nullptr, CREATE_METHOD_TABLE(NodeEventEmitterPrototype) };

JSObject* createNodeEventEmitterPrototype(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    putState(vm, globalObject);
    return NodeEventEmitterPrototype::create(vm, NodeEventEmitterPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

JSObject* nodeEventEmitterPrototype(Zig::GlobalObject* globalObject)
{
    constexpr auto slot = WebCore::DOMStructureSlot::NodeEventEmitter;
    if (auto* structure = globalObject->domStructure(slot))
        return structure->storedPrototypeObject();

    auto* prototype = createNodeEventEmitterPrototype(globalObject);
    globalObject->setDOMStructure(slot, globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, prototype, JSFinalObject::defaultInlineCapacity));
    return prototype;
}

static void moveToEnd(VM& vm, JSGlobalObject* globalObject, JSObject* object, const Identifier& key, PropertyOffset offset, unsigned attributes)
{
    // putDirect() takes no accessor, and what cannot be deleted stays where it is.
    if (attributes & (PropertyAttribute::DontDelete | PropertyAttribute::AccessorOrCustomAccessorOrValue))
        return;
    JSValue value = object->getDirect(offset);
    object->deleteProperty(globalObject, key);
    object->putDirect(vm, key, value, attributes);
}

JSValue nodeEventEmitterPrototypeForModule(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = nodeEventEmitterPrototype(globalObject);
    // node:events is evaluated again when it threw after this call.
    if (prototype->staticPropertiesReified())
        return prototype;

    auto emitName = Identifier::fromString(vm, "emit"_s);
    JSValue emit;
    if (!isValidOffset(prototype->getDirectOffset(vm, emitName))) {
        // The one step that can throw comes before the first change.
        emit = callFactory(vm, globalObject, eventEmitterPrototypeCreateEmitCodeGenerator(vm));
        RETURN_IF_EXCEPTION(scope, {});
    }

    // What native code read or assigned before node:events was evaluated is ahead of the names that the table has before it.
    bool hadProperties = isValidOffset(prototype->structure()->maxOffset());
    // Nothing looks at the table from here on, and deleting a name does not define the others.
    prototype->structure()->setStaticPropertiesReified(true);
    for (auto& entry : eventEmitterPrototypeTableValues) {
        auto key = Identifier::fromString(vm, entry.m_key);
        unsigned attributes;
        PropertyOffset offset = prototype->getDirectOffset(vm, key, attributes);
        if (isValidOffset(offset)) {
            if (hadProperties)
                moveToEnd(vm, globalObject, prototype, key, offset, attributes);
            continue;
        }
        if (key == vm.propertyNames->constructor) {
            // events.ts assigns it. This is the place that it has in the order of the keys.
            prototype->putDirect(vm, key, jsUndefined());
        } else if (key == emitName)
            prototype->putDirect(vm, key, emit);
        else
            reifyStaticProperty(vm, NodeEventEmitterPrototype::info(), key, entry, *prototype);
    }
    return prototype;
}

}
