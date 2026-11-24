#include "root.h"

#include "HostEntries.h"
#include "NativeTests.h"
#include <JavaScriptCore/AOTLoadedProgramTestSupport.h>
#include <JavaScriptCore/AOTModuleHost.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/TopExceptionScope.h>

#if ENABLE(AOT)

namespace JSC { namespace AOT {

static constexpr ASCIILiteral programText = R"IR(module m0 path="/main.js" displayPath="main.js" body=f0 requests=[{target=m1 completes=true}, {target=m2 completes=true}]
module m1 path="bun:jsc" displayPath="bun:jsc" kind=Runtime exportRule=RuntimeModule requireResult=DefaultExport runtimeModule=BunJsc
module m2 path="node:fs" displayPath="node:fs" kind=Runtime exportRule=RuntimeModule requireResult=DefaultExport runtimeModule=NodeFs
entry module=m0

function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = ModuleNamespace module=m1
    PropSet v0, v1 key="nativeModule"
    v3 = ModuleNamespace module=m2
    PropSet v0, v3 key="moduleWithSource"
    Return
}
)IR"_s;

static constexpr ModuleID mainModule { 0u };

static JSObject* namespaceStoredAs(LoadedProgram& program, ASCIILiteral globalName)
{
    VM& vm = program.vm();
    JSGlobalObject* realm = program.realm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    evaluateModuleSynchronously(realm, mainModule);
    AOT_TEST_CHECK(!scope.exception());

    JSValue stored = realm->get(realm, Identifier::fromString(vm, globalName));
    AOT_TEST_CHECK(!scope.exception() && stored.isObject() && isModuleNamespace(stored.asCell()));
    return asObject(stored);
}

static JSValue exportOf(LoadedProgram& program, JSObject* namespaceObject, ASCIILiteral name)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(program.vm());
    JSValue value = namespaceObject->get(program.realm(), Identifier::fromString(program.vm(), name));
    AOT_TEST_CHECK(!scope.exception());
    return value;
}

static void checkNativeModuleExportsWhatHostLists(LoadedProgram& program)
{
    JSObject* namespaceObject = namespaceStoredAs(program, "nativeModule"_s);

    AOT_TEST_CHECK(exportOf(program, namespaceObject, "listedByHost"_s) == jsNumber(2));
    AOT_TEST_CHECK(exportOf(program, namespaceObject, "default"_s) == jsNumber(hostModule("BunJsc"_s).index()));
    AOT_TEST_CHECK(exportOf(program, namespaceObject, "propertyOfModuleObject"_s).isUndefined());
}

template<LoadedProgramTest body>
static constexpr void (*withRuntimeModules)() = runNativeTestWithLoadedProgram<bunNativeModuleExportTests, programText, body>;

std::span<const NativeTest> bunNativeModuleExportTests()
{
    static constexpr NativeTest tests[] = {
        { "native-module-exports/native-module-exports-what-host-lists"_s, withRuntimeModules<checkNativeModuleExportsWhatHostLists> },
    };
    return tests;
}

} } // namespace JSC::AOT

#endif // ENABLE(AOT)
