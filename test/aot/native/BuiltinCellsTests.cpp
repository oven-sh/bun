#include "root.h"

#include "NativeTests.h"
#include <JavaScriptCore/AOTBuiltinTableRealm.h>
#include <JavaScriptCore/AOTLoadedProgramTestSupport.h>
#include <JavaScriptCore/AOTProgramTables.h>

#if ENABLE(AOT)

namespace JSC { namespace AOT {

static constexpr ASCIILiteral programText = R"IR(variable g0 name="buffer" module=m0 declared={type=anything} initialization=Undefined
variable g1 name="maxByteLength" module=m0 declared={type=anything} initialization=Undefined
variable g2 name="symbol" module=m0 declared={type=anything} initialization=Undefined
variable g3 name="bufferPrototype" module=m0 declared={type=anything} initialization=Undefined
variable g4 name="globalObject" module=m0 declared={type=anything} initialization=Undefined
module m0 path="/main.js" displayPath="main.js" body=f0 exports=[{name="buffer" variable=g0}, {name="bufferPrototype" variable=g3}, {name="globalObject" variable=g4}, {name="maxByteLength" variable=g1}, {name="symbol" variable=g2}]
entry module=m0 hostReads=[{exportName="buffer"}, {exportName="maxByteLength"}, {exportName="symbol"}]
function f0 name="main" kind=Module results=[{type=anything}] {
    v0 = Builtin builtin=SymbolIterator
    v1 = Builtin builtin=ArrayBuffer
    v2 = Integer integer=8
    v3 = Construct v1, -, v2
    v4 = PropGet v3 key="maxByteLength"
    v5 = Builtin builtin=ArrayBufferPrototype
    v6 = Builtin builtin=GlobalThis
    PutModuleVariable v3 variable=g0
    PutModuleVariable v4 variable=g1
    PutModuleVariable v0 variable=g2
    PutModuleVariable v5 variable=g3
    PutModuleVariable v6 variable=g4
    Return
}
)IR"_s;

static void checkKeys(LoadedProgram& program)
{
    const BuiltinTable& table = BuiltinTable::singleton();
    std::span<const uint32_t> keys = program.instance().tables().builtinCells();
    AOT_TEST_CHECK(!keys.empty());
    for (uint32_t encoded : keys) {
        std::optional<BuiltinCellKey> key = BuiltinCellKey::decode(encoded, table);
        AOT_TEST_CHECK(key && key->encoded() == encoded && key->hasCell(table));
    }

    AOT_TEST_CHECK(!BuiltinCellKey::decode(UINT32_MAX, table) && !BuiltinCellKey::decode(3u << 24, table) && !BuiltinCellKey::decode(table.builtinCount(), table));
    AOT_TEST_CHECK(BuiltinCellKey::decode(BuiltinCellKey::setter(Builtins::MathMax).encoded(), table) == BuiltinCellKey::setter(Builtins::MathMax));
    AOT_TEST_CHECK(BuiltinCellKey::object(Builtins::MathMax).hasCell(table) && BuiltinCellKey::object(Builtins::SymbolIterator).hasCell(table));
    AOT_TEST_CHECK(!BuiltinCellKey::object(Builtins::MathPI).hasCell(table) && !BuiltinCellKey::getter(Builtins::MathMax).hasCell(table));
    AOT_TEST_CHECK(BuiltinCellKey::getter(Builtins::ArrayBufferPrototypeByteLength).hasCell(table) && !BuiltinCellKey::setter(Builtins::ArrayBufferPrototypeByteLength).hasCell(table));
    AOT_TEST_CHECK(!BuiltinCellKey::getter(Builtins::ArrayPrototypeLength).hasCell(table));
    AOT_TEST_CHECK(!BuiltinCellKey::object(Builtins::ModuleObjectExports).hasCell(table) && !BuiltinCellKey::object(Builtins::ImportMeta).hasCell(table));
    AOT_TEST_CHECK(!BuiltinCellKey::object(Builtins::CompilerHelpers).hasCell(table) && BuiltinCellKey::object(Builtins::CompilerHelpersOwnEntriesFlat).hasCell(table));
}

template<LoadedProgramTest body>
static constexpr void (*withProgram)() = runNativeTestWithLoadedProgram<bunBuiltinCellsTests, programText, body>;

std::span<const NativeTest> bunBuiltinCellsTests()
{
    static constexpr NativeTest tests[] = {
        { "builtin-cells/keys"_s, withProgram<checkKeys> },
    };
    return tests;
}

} } // namespace JSC::AOT

#endif // ENABLE(AOT)
