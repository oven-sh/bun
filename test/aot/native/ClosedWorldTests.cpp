#include "root.h"

#include "NativeTests.h"
#include <JavaScriptCore/AOTBuiltProgramTestSupport.h>
#include <JavaScriptCore/AOTCompileOptions.h>
#include <optional>

#if ENABLE(AOT)

namespace JSC { namespace AOT {

using Flags = OptionSet<ImageFlag>;

static constexpr Flags refusesOriginals { ImageFlag::RefusesOriginalsBesideMocks };
static constexpr Flags closed = refusesOriginals;
static constexpr Flags runsText = refusesOriginals | Flags { ImageFlag::AdmitsUnknownJavaScript, ImageFlag::LoadsModulesByName, ImageFlag::LetsGlobalObjectGo };
static constexpr Flags runsModuleFromOutside = refusesOriginals | Flags { ImageFlag::AdmitsUnknownJavaScript, ImageFlag::LoadsModulesByName, ImageFlag::AllowsLibrarySource, ImageFlag::LetsGlobalObjectGo };
static constexpr Flags loadsCodeFromOutside = runsModuleFromOutside | Flags { ImageFlag::LoadsCodeOutsideImage };
static constexpr Flags runsTextThatLoadsCode = isHardenedBuild ? runsText : loadsCodeFromOutside;

#define AOT_APPLY_EVALUATOR_TEXT R"IR(function f1 name="apply" parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = Builtin builtin=GlobalThis
    v2 = PropGet v1 key="print" [isFreeName]
    v3 = PropGet v1 key="text" [isFreeName]
    Jump -> next b1()
  b1() handler=b3():
    v4 = Call v0, -, v3
    v5 = TypeOf v4
    v6 = Call v2, -, v5
    Jump -> next b2()
  b2():
    Return
  b3() role=CatchHandler:
    v7 = CatchValue
    v8 = PropGet v7 key="name"
    v9 = Call v2, -, v8
    v10 = PropGet v7 key="message"
    v11 = Call v2, -, v10
    Return
}
)IR"

static constexpr ASCIILiteral evaluatorUnderUnknownKeyOfGlobalObject = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="name" [isFreeName]
    v2 = ElemGet v0, v1
    v3 = CallDirect v2 function=f1
    Return
}
)IR" AOT_APPLY_EVALUATOR_TEXT ""_s;

static constexpr ASCIILiteral evaluatorComesBackFromUnknownCode = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="keep" [isFreeName]
    v2 = PropGet v0 key="eval" [isFreeName]
    v3 = Call v1, -, v2
    v4 = PropGet v0 key="kept" [isFreeName]
    v5 = CallDirect v4 function=f1
    Return
}
)IR" AOT_APPLY_EVALUATOR_TEXT ""_s;

static constexpr ASCIILiteral printsSum = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="print" [isFreeName]
    v2 = PropGet v0 key="one" [isFreeName]
    v3 = Add v2, v2
    v4 = Call v1, -, v3
    Return
}
)IR"_s;

static constexpr ASCIILiteral handsOnConstructorOfWorkers = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="print" [isFreeName]
    v2 = Builtin builtin=Worker
    v3 = Call v1, -, v2
    Return
}
)IR"_s;

static constexpr ASCIILiteral handsOnGlobalObject = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="listed"
    v2 = Call v1, v0
    Return
}
)IR"_s;

static constexpr ASCIILiteral handsOnGlobalObjectBesideWorkerWithName = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="listed"
    v2 = Call v1, v0
    v3 = Builtin builtin=Worker
    v4 = String string="./other.js"
    v5 = Construct v3, -, v4
    Return
}
)IR"_s;

static constexpr ASCIILiteral startsWorkerFromUnknownValue = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="name" [isFreeName]
    v2 = Builtin builtin=Worker
    v3 = Construct v2, -, v1
    Return
}
)IR"_s;

static constexpr ASCIILiteral startsTwoWorkersFromUnknownValues = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="name" [isFreeName]
    v2 = Builtin builtin=Worker
    v3 = Construct v2, -, v1
    v4 = Construct v2, -, v1
    Return
}
)IR"_s;

static constexpr ASCIILiteral startsWorkerFromTextOfURL = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=URL
    v1 = String string="./other.js"
    v2 = ModuleBuiltin builtin=ImportMeta module=m0
    v3 = PropGet v2 key="url"
    v4 = Construct v0, -, v1, v3
    v5 = PropGet v4 key="href"
    v6 = Builtin builtin=Worker
    v7 = Construct v6, -, v5
    Return
}
)IR"_s;

static constexpr ASCIILiteral startsWorkerFromAnotherMemberOfURL = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=URL
    v1 = String string="./other.js"
    v2 = ModuleBuiltin builtin=ImportMeta module=m0
    v3 = PropGet v2 key="url"
    v4 = Construct v0, -, v1, v3
    v5 = PropGet v4 key="search"
    v6 = Builtin builtin=Worker
    v7 = Construct v6, -, v5
    Return
}
)IR"_s;

static constexpr ASCIILiteral startsWorkerFromTextOfUnknownURL = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=URL
    v1 = Builtin builtin=GlobalThis
    v2 = PropGet v1 key="name" [isFreeName]
    v3 = Construct v0, -, v2
    v4 = PropGet v3 key="href"
    v5 = Builtin builtin=Worker
    v6 = Construct v5, -, v4
    Return
}
)IR"_s;

static constexpr ASCIILiteral callsUnknownFunction = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="sink" [isFreeName]
    v2 = Call v1, -, v0
    Return
}
)IR"_s;

static constexpr ASCIILiteral evaluatesUnknownText = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="text" [isFreeName]
    v2 = PropGet v0 key="eval" [isFreeName]
    v3 = Call v2, -, v1
    Return
}
)IR"_s;

static constexpr ASCIILiteral constructsFunctionFromUnknownText = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="text" [isFreeName]
    v2 = Builtin builtin=Function
    v3 = Construct v2, -, v1
    Return
}
)IR"_s;

static constexpr ASCIILiteral installsPlugin = R"IR(module m0 path="main.js" displayPath="main.js" body=f0
entry module=m0
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=Bun
    v1 = Builtin builtin=GlobalThis
    v2 = PropGet v1 key="plugin" [isFreeName]
    v3 = Builtin builtin=BunPlugin
    v4 = Call v3, v0, v2
    Return
}
)IR"_s;

static constexpr ASCIILiteral evaluatesTextBesideOtherModule = R"IR(module m0 path="/main.js" displayPath="main.js" body=f0
module m1 path="/other.js" displayPath="other.js" body=f1
entry module=m0
function f0 name="main" module=m0 kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="text" [isFreeName]
    v2 = PropGet v0 key="eval" [isFreeName]
    v3 = Call v2, -, v1
    Return
}
function f1 name="other" module=m1 kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="print" [isFreeName]
    v2 = String string="other ran"
    v3 = Call v1, -, v2
    Return
}
)IR"_s;

static constexpr ASCIILiteral unseenCodeMayCallLoader = R"IR(module m0 path="/main.js" displayPath="main.js" body=f0
module m1 path="/other.js" displayPath="other.js" body=f1
entry module=m0
function f0 name="main" module=m0 kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="text" [isFreeName]
    v2 = PropGet v0 key="eval" [isFreeName]
    v3 = Call v2, -, v1
    v4 = PropGet v0 key="sink" [isFreeName]
    v5 = Builtin builtin=Process
    v6 = Call v4, -, v5
    v7 = PropGet v0 key="name" [isFreeName]
    v8 = ElemGet v6, v7
    v9 = Call v8, v6, v7
    Return
}
function f1 name="other" module=m1 kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="print" [isFreeName]
    v2 = String string="other ran"
    v3 = Call v1, -, v2
    Return
}
)IR"_s;

#define AOT_COMMONJS_SIGNATURE R"IR(kind=CommonJsModule thisType={type=anything} results=[{type=anything}] {
  b0():
)IR"

#define AOT_STORES_PATH_OF_MAIN_MODULE(replaceableBuiltins) R"IR(module m0 path="/app/main.cjs" displayPath="main.cjs" kind=CommonJs flags=[CachesEvaluationError] body=f0
entry module=m0
)IR" replaceableBuiltins R"IR(function f0 name="main" module=m0 )IR" AOT_COMMONJS_SIGNATURE R"IR(    v0 = Builtin builtin=GlobalThis
    v1 = PropGet v0 key="path" [isFreeName]
    v2 = Builtin builtin=Bun
    PropSet v2, v1 key="main"
    Return
}
)IR"_s

static constexpr ASCIILiteral storesPathOfMainModuleLeftOpen = AOT_STORES_PATH_OF_MAIN_MODULE("replaceablebuiltin member=Bun_main\n");
static constexpr ASCIILiteral storesPathOfMainModuleDecidedInCode = AOT_STORES_PATH_OF_MAIN_MODULE("");

static constexpr ASCIILiteral holdsMockOfRuntimeModule = R"IR(variable g0 module=m1 declared={type=anything|absent} flags=[IsReplaceable, HoldsMock]
module m0 path="/main.js" displayPath="main.js" body=f0 requests=[{target=m1 completes=true}]
module m1 path="node:fs" displayPath="node:fs" kind=Runtime flags=[MayBeMocked] exportRule=RuntimeModule requireResult=DefaultExport runtimeModule=NodeFs
entry module=m0
function f0 name="main" module=m0 kind=Module results=[{type=anything}] {
    Return
}
)IR"_s;

static constexpr ASCIILiteral holdsMockOfFileBesideRuntimeModuleWhoseOriginalMayRun = R"IR(variable g0 name="exports" module=m1 declared={type=anything} initialization=Undefined
variable g1 module=m1 declared={type=anything|absent} flags=[IsReplaceable, HoldsMock]
variable g2 module=m2 declared={type=anything|absent} flags=[IsReplaceable, HoldsMock, OriginalMayRun]
module m0 path="/main.js" displayPath="main.js" body=f0 requests=[{target=m2 completes=true}]
module m1 path="/mocked.cjs" displayPath="mocked.cjs" kind=CommonJs flags=[CachesEvaluationError, MayBeMocked] requireResult=ModuleExports body=f1 exportsVariable=g0
module m2 path="node:fs" displayPath="node:fs" kind=Runtime flags=[MayBeMocked] exportRule=RuntimeModule requireResult=DefaultExport runtimeModule=NodeFs
entry module=m0
entry module=m1
function f0 name="main" module=m0 kind=Module results=[{type=anything}] {
    Return
}
function f1 name="mocked" module=m1 kind=CommonJsModule flags=[IsSloppy] results=[{type=anything}] {
    v0 = Integer integer=1
    PutModuleVariable v0 variable=g0
    Return
}
)IR"_s;

static void testCallThatStartsUnseenCodeAdmitsWhatTextMayLoad()
{
    checkImageFlags({
        { evaluatesUnknownText, runsText, { "exclude=CodeOutsideImage"_s } },
        { evaluatesUnknownText, runsTextThatLoadsCode },
        { constructsFunctionFromUnknownText, runsTextThatLoadsCode },
        { installsPlugin, runsTextThatLoadsCode },
        { evaluatesTextBesideOtherModule, runsTextThatLoadsCode },
        { unseenCodeMayCallLoader, runsTextThatLoadsCode },
        { evaluatorComesBackFromUnknownCode, runsTextThatLoadsCode },
        { callsUnknownFunction, runsTextThatLoadsCode },
        { evaluatorUnderUnknownKeyOfGlobalObject, runsTextThatLoadsCode },
    });
}

static void testCodeThatNobodyHasReadIsNoWorkerStartedWithoutName()
{
    auto startsWithoutName = [](ASCIILiteral program, std::initializer_list<ASCIILiteral> words) {
        return workerStartsWithoutNameOf(program, words).size();
    };
    AOT_TEST_CHECK(!startsWithoutName(printsSum, { }));
    AOT_TEST_CHECK(!startsWithoutName(printsSum, { "admit=Inspector"_s }));
    AOT_TEST_CHECK(!startsWithoutName(evaluatesUnknownText, { }));
    AOT_TEST_CHECK(startsWithoutName(handsOnConstructorOfWorkers, { }) == 1);
    AOT_TEST_CHECK(startsWithoutName(handsOnConstructorOfWorkers, { "exclude=CodeOutsideImage"_s }) == 1);
    AOT_TEST_CHECK(startsWithoutName(startsWorkerFromUnknownValue, { }) == 1);
    AOT_TEST_CHECK(startsWithoutName(startsTwoWorkersFromUnknownValues, { }) == 2);
}

static void testStartOfWorkerHasPlaceOnlyWhereConstructorWasSeen()
{
    auto startHasPlace = [](ASCIILiteral program) -> std::optional<bool> {
        Vector<Wire::WorkerStartRecord> starts = workerStartsWithoutNameOf(program);
        if (starts.isEmpty())
            return std::nullopt;
        return starts[0].witness.function != Wire::none;
    };
    AOT_TEST_CHECK(startHasPlace(handsOnGlobalObject) == false);
    AOT_TEST_CHECK(startHasPlace(handsOnGlobalObjectBesideWorkerWithName) == false);
    AOT_TEST_CHECK(startHasPlace(handsOnConstructorOfWorkers) == true);
    AOT_TEST_CHECK(startHasPlace(startsWorkerFromUnknownValue) == true);
    AOT_TEST_CHECK(startHasPlace(startsWorkerFromTextOfURL) == std::nullopt);
    AOT_TEST_CHECK(startHasPlace(startsWorkerFromAnotherMemberOfURL) == true);
    AOT_TEST_CHECK(startHasPlace(startsWorkerFromTextOfUnknownURL) == true);
}

static void testStoreIntoPathOfMainModuleIsTakenWhereFrontEndLeftItOpen()
{
    AOT_TEST_CHECK(imageFlagsOf(storesPathOfMainModuleLeftOpen).contains(ImageFlag::SetsMainModulePath));
    AOT_TEST_CHECK(!imageFlagsOf(storesPathOfMainModuleDecidedInCode).contains(ImageFlag::SetsMainModulePath));
    AOT_TEST_CHECK(!imageFlagsOf(storesPathOfMainModuleDecidedInCode, { "admit=Inspector"_s }).contains(ImageFlag::SetsMainModulePath));
}

static void testExcludedTextLeavesTheProgramClosed()
{
    checkImageFlags({
        { evaluatesUnknownText, closed, { "exclude=EvaluatedText"_s } },
        { installsPlugin, runsTextThatLoadsCode, { "exclude=EvaluatedText"_s } },
        { evaluatesUnknownText, runsTextThatLoadsCode, { "exclude=HostEvaluatedText"_s } },
    });
}

static constexpr ASCIILiteral testRunWord = "admit=ReplacedBuiltins"_s;

static void testMockOfModuleOfRunTimeIsMockOfNoFile()
{
    checkImageFlags({
        { holdsMockOfRuntimeModule, Flags { }, { testRunWord } },
        { holdsMockOfRuntimeModule, refusesOriginals },
    });
}

static void testOriginalOfModuleOfRunTimeIsOriginalOfNoFile()
{
    checkImageFlags({
        { holdsMockOfFileBesideRuntimeModuleWhoseOriginalMayRun, refusesOriginals, { testRunWord } },
        { holdsMockOfFileBesideRuntimeModuleWhoseOriginalMayRun, refusesOriginals },
    });
}

std::span<const NativeTest> bunClosedWorldTests()
{
    static constexpr NativeTest tests[] = {
        { "closed-world/flags/call-that-starts-unseen-code-admits-what-a-text-may-load"_s, testCallThatStartsUnseenCodeAdmitsWhatTextMayLoad },
        { "closed-world/flags/code-that-nobody-has-read-is-no-worker-started-without-a-name"_s, testCodeThatNobodyHasReadIsNoWorkerStartedWithoutName },
        { "closed-world/flags/start-of-worker-has-place-only-where-constructor-was-seen"_s, testStartOfWorkerHasPlaceOnlyWhereConstructorWasSeen },
        { "closed-world/flags/store-into-path-of-main-module-is-taken-where-front-end-left-it-open"_s, testStoreIntoPathOfMainModuleIsTakenWhereFrontEndLeftItOpen },
        { "closed-world/flags/excluded-text-leaves-the-program-closed"_s, testExcludedTextLeavesTheProgramClosed },
        { "closed-world/flags/mock-of-a-module-of-the-run-time-is-a-mock-of-no-file"_s, testMockOfModuleOfRunTimeIsMockOfNoFile },
        { "closed-world/flags/original-of-a-module-of-the-run-time-is-the-original-of-no-file"_s, testOriginalOfModuleOfRunTimeIsOriginalOfNoFile },
    };
    return tests;
}

} } // namespace JSC::AOT

#endif // ENABLE(AOT)
