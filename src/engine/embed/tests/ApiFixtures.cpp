#include "ApiFixtures.h"

#include <mutex>

namespace Test {

using namespace JSC;

class GlobalObject final : public JSGlobalObject {
public:
    using Base = JSGlobalObject;

    DECLARE_INFO;

    static GlobalObject* create(VM& vm, IsoSubspace& space, const GlobalObjectMethodTable* methods)
    {
        auto* structure = Structure::create(vm, nullptr, jsNull(), TypeInfo(GlobalObjectType, StructureFlags), info());
        auto* global = new (NotNull, space.allocate(vm.heap, sizeof(GlobalObject))) GlobalObject(vm, structure, methods);
        global->finishCreation(vm);
        return global;
    }

private:
    GlobalObject(VM& vm, Structure* structure, const GlobalObjectMethodTable* methods)
        : Base(vm, structure, methods ? methods : &defaultMethods)
    {
    }

    static void trackRejection(JSGlobalObject*, JSPromise*, JSPromiseRejectionOperation operation) { Realm::log(operation == JSPromiseRejectionOperation::Reject ? "reject"_s : "handle"_s); }
    static void reportException(JSGlobalObject* global, Exception* exception) { Realm::log(makeString("uncaught "_s, exception->value().toWTFString(global))); }

    static constexpr GlobalObjectMethodTable defaultMethods {
        .promiseRejectionTracker = trackRejection,
        .reportUncaughtExceptionAtEventLoop = reportException,
        .currentScriptExecutionOwner = currentScriptExecutionOwner,
        .scriptExecutionStatus = scriptExecutionStatus,
    };
};

const ClassInfo GlobalObject::s_info = { "GlobalObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(GlobalObject) };

struct ClientData final : VM::ClientData {
    explicit ClientData(VM& vm)
        : globalObjects(vm.heap.createIsoSubspace(sizeof(GlobalObject), GlobalObject::destroy, false))
    {
    }

    void reportErrorOfMicrotask(JSGlobalObject* global, Exception* exception) final { Realm::log(makeString("error of microtask "_s, exception->value().toWTFString(global))); }

    IsoSubspace& globalObjects;
};

static VM& createVM()
{
    static std::once_flag once;
    std::call_once(once, [] {
        initialize([] {
            EXPECT(Options::setOption("slowPathAllocsBetweenGCs=1"));
            Options::defaultErrorStackTraceLimit() = 7;
        });
    });
    VM& vm = *VM::tryCreate().leakRef();
    vm.clientData = new ClientData(vm);
    return vm;
}

Realm::Realm(const GlobalObjectMethodTable* methods)
    : vm(createVM())
    , global(createGlobalObject(methods))
{
    gcProtect(global);
    takeLog();
}

Realm::~Realm()
{
    EXPECT(!vm.exceptionForInspection());
    gcUnprotect(global);
    vm.deref();
}

JSGlobalObject* Realm::createGlobalObject(const GlobalObjectMethodTable* methods)
{
    return GlobalObject::create(vm, static_cast<ClientData*>(vm.clientData)->globalObjects, methods);
}

JSValue Realm::run(ASCIILiteral source)
{
    NakedPtr<Exception> exception;
    JSValue result = evaluate(global, makeSource(source, {}, SourceTaintedOrigin::Untainted, "test.js"_s), {}, exception);
    if (exception)
        fail(__FILE__, __LINE__, makeString(source, " not to throw "_s, text(exception->value())).utf8().legacyCStringPointer());
    return result;
}

String Realm::text(JSValue value)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    String result = value.toWTFString(global);
    scope.releaseAssertNoException();
    return result;
}

String Realm::takeException()
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    Exception* exception = scope.exception();
    if (!exception)
        return "nothing"_s;
    scope.clearException();
    return text(exception->value());
}

static StringBuilder& entries()
{
    static NeverDestroyed<StringBuilder> entries;
    return entries;
}

void Realm::log(const String& entry)
{
    entries().append(entries().isEmpty() ? ""_s : ", "_s, entry);
}

String Realm::takeLog()
{
    String result = entries().toString();
    entries().clear();
    return result;
}

}

extern "C" JSC::EncodedJSValue Bun__analyzeTranspiledModule(JSC::JSGlobalObject*, JSC::JSModuleLoader*, const JSC::Identifier&, const JSC::SourceCode&, JSC::JSPromise*)
{
    RELEASE_ASSERT_NOT_REACHED();
}
