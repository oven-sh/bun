#include "root.h"

#include "NativeTests.h"
#include <JavaScriptCore/AOTGlobalBindings.h>
#include <JavaScriptCore/AOTImage.h>
#include <JavaScriptCore/AOTLoadedProgramTestSupport.h>
#include <JavaScriptCore/JSCInlines.h>

#if ENABLE(AOT)

WTF_ALLOW_UNSAFE_BUFFER_USAGE_BEGIN

namespace JSC { namespace AOT {

static constexpr ASCIILiteral programForManyInstances = R"IR(variable g0 name="worker" declared={type=anything}
module m0 path="main.js" displayPath="main.js" body=f0 exports=[{name="worker" variable=g0}]
entry hostReads=[{exportName="worker"}]
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=Worker
    PutModuleVariable v0 variable=g0
    v2 = Builtin builtin=GlobalThis
    v3 = PropGet v2 key="shared" [isFreeName]
    PropSet v2, v3 key="shared" mode=Sloppy
    Return
}
)IR"_s;

static uint32_t recordOf(LoadedProgram& program, ASCIILiteral name, bool seesScriptBindings)
{
    GlobalBindings& bindings = *program.state().globalBindings;
    Identifier wanted = Identifier::fromString(program.vm(), name);
    std::optional<uint32_t> found;
    for (uint32_t number = 0; number < program.state().tables.globalBindings().size(); ++number) {
        if (bindings.nameOf(number) != wanted || bindings.seesScriptBindings(number) != seesScriptBindings)
            continue;
        AOT_TEST_CHECK(!found);
        found = number;
    }
    AOT_TEST_CHECK(found);
    return *found;
}

static void allowWatchedConstantInGlobalBinding(LoadedProgram& program, uint32_t number)
{
    const uint32_t& word = program.state().tables.globalBindings()[number];
    overwriteWordInImage(word, word & ~GlobalBindings::isStoredByNameFlag);
}

static void defineShared(LoadedProgram& program, JSValue value)
{
    program.realm()->putDirect(program.vm(), Identifier::fromString(program.vm(), "shared"_s), value);
}

static void testWorkerHasItsOwnRecords(LoadedProgram& program)
{
    VM& vm = program.vm();
    const ProgramTables& tables = Image::current()->programTables();
    overwriteWordInImage(tables.flags, tables.flags | ProgramTables::mayRunInMultipleInstances);
    Instance* second = Instance::of(JSGlobalObject::createWithCustomMethodTable(vm, JSGlobalObject::createStructure(vm, jsNull()), program.realm()->globalObjectMethodTable()));
    AOT_TEST_CHECK(second && second->state && second->state->globalBindings);

    Instance& first = program.instance();
    AOT_TEST_CHECK(first.runtime.bindings.globalBindings && second->runtime.bindings.globalBindings);
    AOT_TEST_CHECK(first.runtime.bindings.globalBindings != second->runtime.bindings.globalBindings);
    for (Instance* instance : { &first, second }) {
        AOT_TEST_CHECK(instance->runtime.bindings.globalBindings == instance->tableAt<GlobalBinding>(InstanceLayout::offsetOfGlobalBindings(tables.instanceSizes)));
        AOT_TEST_CHECK(instance->prefix().builtinCells == instance->tableAt<JSCell*>(InstanceLayout::offsetOfBuiltinCells));
        AOT_TEST_CHECK(instance->builtins.hostValues == instance->tableAt<EncodedJSValue>(InstanceLayout::offsetOfBuiltinValues));
    }

    uint32_t number = recordOf(program, "shared"_s, true);
    allowWatchedConstantInGlobalBinding(program, number);
    GlobalBinding& record = program.state().globalBindings->at(number);
    GlobalBinding& recordOfSecond = second->state->globalBindings->at(number);
    AOT_TEST_CHECK(&record == &first.runtime.bindings.globalBindings[number] && &recordOfSecond == &second->runtime.bindings.globalBindings[number]);
    AOT_TEST_CHECK(!record.constant && !record.structureID && !record.location);

    defineShared(program, jsNumber(1));
    AOT_TEST_CHECK(program.state().globalBindings->fileConstant(vm, number, program.realm(), jsNumber(1)));
    AOT_TEST_CHECK(record.constant == JSValue::encode(jsNumber(1)));
    AOT_TEST_CHECK(!recordOfSecond.constant && !recordOfSecond.structureID && !recordOfSecond.location);

    second->state->globalBindings->dropConstants();
    AOT_TEST_CHECK(record.constant == JSValue::encode(jsNumber(1)));

    defineShared(program, jsNumber(2));
    AOT_TEST_CHECK(!record.constant);
}

template<LoadedProgramTest body>
static constexpr void (*inManyInstances)() = runNativeTestWithLoadedProgram<bunGlobalBindingProgramTests, programForManyInstances, body>;

std::span<const NativeTest> bunGlobalBindingProgramTests()
{
    static constexpr NativeTest tests[] = {
        { "global-bindings/worker-has-its-own-records"_s, inManyInstances<testWorkerHasItsOwnRecords> },
    };
    return tests;
}

} } // namespace JSC::AOT

WTF_ALLOW_UNSAFE_BUFFER_USAGE_END

#endif // ENABLE(AOT)
