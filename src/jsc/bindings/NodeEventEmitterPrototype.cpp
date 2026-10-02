#include "root.h"

#include "NodeEventEmitterPrototype.h"

#include "BunProcess.h"
#include "InternalModuleRegistry.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/Symbol.h>

namespace Bun {

using namespace JSC;

// The functions of a static table entry below run when a program first reads the property. One that evaluates a
// module returns an empty value when the module threw: the read throws, and the next read evaluates it again.

// What src/js/internal/events/prototype.ts exports under `name`.
static JSValue exportedMethod(VM& vm, Zig::GlobalObject* globalObject, ASCIILiteral name)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue exports = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::Field::InternalEventsPrototype);
    if (scope.exception()) [[unlikely]]
        return {};
    return asObject(exports)->getDirect(vm, Identifier::fromString(vm, name));
}

template<size_t length>
struct ExportName {
    char characters[length];
    consteval ExportName(const char (&name)[length]) { std::copy_n(name, length, characters); }
};

template<ExportName name>
static JSValue eventEmitterMethod(VM& vm, JSObject* prototype)
{
    return exportedMethod(vm, defaultGlobalObject(prototype->globalObject()), ASCIILiteral::fromLiteralUnsafe(name.characters));
}

// The EventEmitter function of node:events.
static JSValue eventEmitterConstructor(VM& vm, JSObject* prototype)
{
    auto* globalObject = defaultGlobalObject(prototype->globalObject());
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue constructor = globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::Field::NodeEvents);
    if (scope.exception()) [[unlikely]]
        return {};
    return constructor;
}

// What a stream inherits: it has its `_events` before the constructor runs, which then leaves the count alone.
static JSValue eventEmitterEventsCount(VM&, JSObject*)
{
    return jsNumber(0);
}

// The own string keys of the prototype, in the order that the object literal of events.ts had.
/* Source for NodeEventEmitterPrototype.lut.h
@begin nodeEventEmitterPrototypeTable
  setMaxListeners        eventEmitterMethod<"setMaxListeners">        PropertyCallback
  constructor            eventEmitterConstructor                      PropertyCallback
  getMaxListeners        eventEmitterMethod<"getMaxListeners">        PropertyCallback
  emit                   eventEmitterMethod<"emit">                   PropertyCallback
  addListener            eventEmitterMethod<"addListener">            PropertyCallback
  on                     eventEmitterMethod<"addListener">            PropertyCallback
  prependListener        eventEmitterMethod<"prependListener">        PropertyCallback
  once                   eventEmitterMethod<"once">                   PropertyCallback
  prependOnceListener    eventEmitterMethod<"prependOnceListener">    PropertyCallback
  removeListener         eventEmitterMethod<"removeListener">         PropertyCallback
  off                    eventEmitterMethod<"removeListener">         PropertyCallback
  removeAllListeners     eventEmitterMethod<"removeAllListeners">     PropertyCallback
  listeners              eventEmitterMethod<"listeners">              PropertyCallback
  rawListeners           eventEmitterMethod<"rawListeners">           PropertyCallback
  listenerCount          eventEmitterMethod<"listenerCount">          PropertyCallback
  eventNames             eventEmitterMethod<"eventNames">             PropertyCallback
  _eventsCount           eventEmitterEventsCount                      PropertyCallback
@end
*/
#include "NodeEventEmitterPrototype.lut.h"

// A property of the table above is created when it is first read. Each one is a plain value. An entry with a
// getter or a setter would send every assignment to an emitter through the path that looks for setters.
class NodeEventEmitterPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeEventEmitterPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static NodeEventEmitterPrototype* create(VM& vm, JSGlobalObject* globalObject)
    {
        auto* structure = Structure::create(vm, globalObject, globalObject->objectPrototype(), TypeInfo(ObjectType, StructureFlags), info());
        auto* prototype = new (NotNull, allocateCell<NodeEventEmitterPrototype>(vm)) NodeEventEmitterPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

private:
    NodeEventEmitterPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
};

const ClassInfo NodeEventEmitterPrototype::s_info = { "EventEmitter"_s, &Base::s_info, &nodeEventEmitterPrototypeTable, nullptr, CREATE_METHOD_TABLE(NodeEventEmitterPrototype) };

JSObject* createNodeEventEmitterPrototype(VM& vm, JSGlobalObject* globalObject, Symbol* kCapture)
{
    auto* prototype = NodeEventEmitterPrototype::create(vm, globalObject);
    prototype->putDirect(vm, Identifier::fromUid(kCapture->privateName()), jsBoolean(false));
    return prototype;
}

JSValue nodeEventEmitterEmit(Zig::GlobalObject* globalObject)
{
    return exportedMethod(JSC::getVM(globalObject), globalObject, "emit"_s);
}

JSValue nodeEventEmitterEmitIfEvaluated(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    JSValue exports = globalObject->internalModuleRegistry()->internalField(InternalModuleRegistry::Field::InternalEventsPrototype).get();
    if (!exports || !exports.isObject())
        return {};
    return asObject(exports)->getDirect(vm, Identifier::fromString(vm, "emit"_s));
}

JSValue nodeEventEmitterPrototype(Zig::GlobalObject* globalObject)
{
    return globalObject->processObject()->eventEmitterPrototype();
}

JSValue nodeEventEmitterShapeModeSymbol(Zig::GlobalObject* globalObject)
{
    return globalObject->processObject()->shapeModeSymbol();
}

JSValue nodeEventEmitterCaptureSymbol(Zig::GlobalObject* globalObject)
{
    return globalObject->processObject()->captureSymbol();
}

}
