#include "root.h"

#include "NativeTests.h"
#include <JavaScriptCore/AOTBuiltinModules.h>
#include <JavaScriptCore/AOTLoadedProgramTestSupport.h>
#include <JavaScriptCore/AOTModules.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/PropertyDescriptor.h>
#include <JavaScriptCore/TopExceptionScope.h>

#if ENABLE(AOT)

namespace JSC { namespace AOT {

static constexpr ASCIILiteral recordOfInternalFileIsFrozenAtDoorTest = "exports-that-stay-in-compiled-code/the-record-of-an-internal-file-is-frozen-where-anything-but-compiled-code-asks-for-it"_s;
static constexpr ASCIILiteral recordThatIsStoredIntoIsNotFrozenTest = "exports-that-stay-in-compiled-code/a-record-that-compiled-code-stores-into-behind-its-birth-goes-whole-and-is-not-frozen"_s;
static constexpr ASCIILiteral recordIsKeptWhereCodeFromOutsideIsRefusedTest = "exports-that-stay-in-compiled-code/where-code-from-outside-is-refused-the-record-is-kept-and-no-door-freezes-it"_s;
static constexpr ASCIILiteral recordIsFrozenAtBirthUnderInspectorTest = "exports-that-stay-in-compiled-code/under-the-inspector-the-record-of-an-internal-file-is-frozen-where-its-body-hands-it-back"_s;
static constexpr ASCIILiteral recordIsNotFrozenAheadOfDoorTest = "exports-that-stay-in-compiled-code/without-the-inspector-the-record-of-an-internal-file-is-not-frozen-ahead-of-the-door"_s;
static constexpr ModuleID internalFile { 1u };
static constexpr ModuleID publicFileThatRequiresInternalFile { 2u };

static constexpr ASCIILiteral textWithInternalFile = R"IR(layout L0 module=m1 fields=[{key="size" declared={type=anything} flags=[IsRequired]}] ownFieldCount=1
module m0 path="/main.js" displayPath="main.js" body=f0 requests=[{target=m2 kind=Require completes=true}]
module m1 path="internal:net/isIP" displayPath="internal:net/isIP" kind=RuntimeSource flags=[IsLoadedByImportOnly, IsHeldUnderNameWithoutPrefix] exportRule=RuntimeModule requireResult=DefaultExport runtimeModule=InternalNetIsIP body=f1
module m2 path="node:net" displayPath="node:net" kind=RuntimeSource flags=[IsHeldUnderNameWithoutPrefix] exportRule=RuntimeModule requireResult=DefaultExport runtimeModule=NodeNet body=f2
entry module=m0

function f0 name="main" module=m0 kind=Module results=[{type=anything}] {
    v0 = RequireModule module=m2 referrer=m0 specifier="node:net"
    Return
}
function f1 module=m1 kind=Module role=Library results=[{type=anything}] {
    v0 = Integer integer=3
    v1 = NewObject -, v0 layout=L0 fields=[0]
    v2 = FinishObject v1
    Return v2
}
function f2 module=m2 kind=Module role=Library results=[{type=anything}] {
    v0 = RequireModule module=m1 referrer=m2 specifier="internal/net/isIP"
    v1 = PropGet v0 key="size"
    Return v1
}
)IR"_s;

static constexpr ASCIILiteral textWithInternalFileThatIsStoredInto = R"IR(layout L0 module=m1 fields=[{key="size" declared={type=anything} flags=[IsRequired]}] ownFieldCount=1
module m0 path="/main.js" displayPath="main.js" body=f0 requests=[{target=m2 kind=Require completes=true}]
module m1 path="internal:net/isIP" displayPath="internal:net/isIP" kind=RuntimeSource flags=[IsLoadedByImportOnly, IsHeldUnderNameWithoutPrefix] exportRule=RuntimeModule requireResult=DefaultExport runtimeModule=InternalNetIsIP body=f1
module m2 path="node:net" displayPath="node:net" kind=RuntimeSource flags=[IsHeldUnderNameWithoutPrefix] exportRule=RuntimeModule requireResult=DefaultExport runtimeModule=NodeNet body=f2
entry module=m0

function f0 name="main" module=m0 kind=Module results=[{type=anything}] {
    v0 = RequireModule module=m2 referrer=m0 specifier="node:net"
    Return
}
function f1 module=m1 kind=Module role=Library results=[{type=anything}] {
    v0 = Integer integer=3
    v1 = NewObject -, v0 layout=L0 fields=[0]
    v2 = FinishObject v1
    Return v2
}
function f2 module=m2 kind=Module role=Library results=[{type=anything}] {
    v0 = RequireModule module=m1 referrer=m2 specifier="internal/net/isIP"
    v1 = PropGet v0 key="size"
    v2 = Integer integer=4
    PropSet v0, v2 key="size"
    Return v1
}
)IR"_s;

static JSObject* recordHandedToWhoeverAsksRegistry(LoadedProgram& program)
{
    std::optional<uint32_t> registryID = modulesOf(program.instance()).data(internalFile).registryID();
    AOT_TEST_CHECK(registryID);
    AOT_TEST_CHECK(hasBuiltinModule(program.realm(), *registryID));
    JSValue handedOut = evaluateBuiltinModule(program.realm(), *registryID);
    AOT_TEST_CHECK(handedOut.isObject());
    return asObject(handedOut);
}

static bool isFrozenForTest(LoadedProgram& program, JSObject* record)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(program.vm());
    PropertyDescriptor size;
    bool hasSize = record->getOwnPropertyDescriptor(program.realm(), Identifier::fromString(program.vm(), "size"_s), size);
    bool isExtensible = record->isExtensible(program.realm());
    AOT_TEST_CHECK(hasSize && !scope.exception());
    AOT_TEST_CHECK(isExtensible == size.writable() && isExtensible == size.configurable());
    return !isExtensible;
}

static void checkRecordIsFrozenAtDoor(LoadedProgram& program)
{
    const ModuleTable& table = modulesOf(program.instance()).table();
    uint32_t registryID = *modulesOf(program.instance()).data(internalFile).registryID();
    AOT_TEST_CHECK(table.recordOfRuntimeSourceIsHandedOutFrozen(registryID));
    AOT_TEST_CHECK(table.valueOfRuntimeSourceStaysWithCompiledCode(registryID));
    willHandBuiltinModuleToNativeCode(program.realm(), registryID);
    JSObject* record = recordHandedToWhoeverAsksRegistry(program);
    AOT_TEST_CHECK(isFrozenForTest(program, record));
    AOT_TEST_CHECK(record->get(program.realm(), Identifier::fromString(program.vm(), "size"_s)) == jsNumber(3));

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(program.vm());
    PutPropertySlot strict(record, true);
    record->methodTable()->put(record, program.realm(), Identifier::fromString(program.vm(), "size"_s), jsNumber(5), strict);
    AOT_TEST_CHECK(scope.exception());
    scope.clearException();
    AOT_TEST_CHECK(record->get(program.realm(), Identifier::fromString(program.vm(), "size"_s)) == jsNumber(3));
}

static void checkRecordThatIsStoredIntoIsNotFrozen(LoadedProgram& program)
{
    const ModuleTable& table = modulesOf(program.instance()).table();
    uint32_t registryID = *modulesOf(program.instance()).data(internalFile).registryID();
    AOT_TEST_CHECK(!table.recordOfRuntimeSourceIsHandedOutFrozen(registryID));
    AOT_TEST_CHECK(!table.valueOfRuntimeSourceStaysWithCompiledCode(registryID));
    AOT_TEST_CHECK(!isFrozenForTest(program, recordHandedToWhoeverAsksRegistry(program)));
}

static void checkRecordIsKeptWhereCodeFromOutsideIsRefused(LoadedProgram& program)
{
    const ModuleTable& table = modulesOf(program.instance()).table();
    uint32_t registryID = *modulesOf(program.instance()).data(internalFile).registryID();
    AOT_TEST_CHECK(!table.recordOfRuntimeSourceIsHandedOutFrozen(registryID));
    AOT_TEST_CHECK(table.valueOfRuntimeSourceStaysWithCompiledCode(registryID));
    AOT_TEST_CHECK(!isFrozenForTest(program, recordHandedToWhoeverAsksRegistry(program)));
}

static JSObject* recordThatCompiledImporterWasHanded(LoadedProgram& program)
{
    Modules& modules = modulesOf(program.instance());
    uint32_t registryID = *modules.data(internalFile).registryID();
    AOT_TEST_CHECK(modules.table().recordOfRuntimeSourceIsHandedOutFrozen(registryID));
    AOT_TEST_CHECK(modules.table().valueOfRuntimeSourceStaysWithCompiledCode(registryID));
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(program.vm());
    AOT_TEST_CHECK(modules.require(publicFileThatRequiresInternalFile) == jsNumber(3));
    AOT_TEST_CHECK(!scope.exception());
    JSValue held = modules.value(internalFile);
    AOT_TEST_CHECK(held.isObject());
    return asObject(held);
}

static void checkRecordIsFrozenAtBirthUnderInspector(LoadedProgram& program)
{
    JSObject* record = recordThatCompiledImporterWasHanded(program);
    AOT_TEST_CHECK(isFrozenForTest(program, record));

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(program.vm());
    PutPropertySlot strict(record, true);
    record->methodTable()->put(record, program.realm(), Identifier::fromString(program.vm(), "size"_s), jsNumber(5), strict);
    AOT_TEST_CHECK(scope.exception());
    scope.clearException();
    AOT_TEST_CHECK(record->get(program.realm(), Identifier::fromString(program.vm(), "size"_s)) == jsNumber(3));
    AOT_TEST_CHECK(recordHandedToWhoeverAsksRegistry(program) == record);
}

static void checkRecordIsNotFrozenAheadOfDoor(LoadedProgram& program)
{
    JSObject* record = recordThatCompiledImporterWasHanded(program);
    AOT_TEST_CHECK(!isFrozenForTest(program, record));
    AOT_TEST_CHECK(recordHandedToWhoeverAsksRegistry(program) == record);
    AOT_TEST_CHECK(isFrozenForTest(program, record));
}

static void recordIsFrozenAtBirthUnderInspector()
{
    runWithLoadedProgram(recordIsFrozenAtBirthUnderInspectorTest, textWithInternalFile, checkRecordIsFrozenAtBirthUnderInspector, { "admit=Inspector"_s });
}

static void recordIsNotFrozenAheadOfDoor()
{
    runWithLoadedProgram(recordIsNotFrozenAheadOfDoorTest, textWithInternalFile, checkRecordIsNotFrozenAheadOfDoor);
}

static void recordOfInternalFileIsFrozenAtDoor()
{
    runWithLoadedProgram(recordOfInternalFileIsFrozenAtDoorTest, textWithInternalFile, checkRecordIsFrozenAtDoor);
}

static void recordThatIsStoredIntoIsNotFrozen()
{
    runWithLoadedProgram(recordThatIsStoredIntoIsNotFrozenTest, textWithInternalFileThatIsStoredInto, checkRecordThatIsStoredIntoIsNotFrozen);
}

static void recordIsKeptWhereCodeFromOutsideIsRefused()
{
    runWithLoadedProgram(recordIsKeptWhereCodeFromOutsideIsRefusedTest, textWithInternalFile, checkRecordIsKeptWhereCodeFromOutsideIsRefused, { "exclude=CodeOutsideImage"_s });
}

std::span<const NativeTest> bunExportsThatStayInCompiledCodeTests()
{
    static constexpr NativeTest tests[] = {
        { recordOfInternalFileIsFrozenAtDoorTest, recordOfInternalFileIsFrozenAtDoor },
        { recordThatIsStoredIntoIsNotFrozenTest, recordThatIsStoredIntoIsNotFrozen },
        { recordIsKeptWhereCodeFromOutsideIsRefusedTest, recordIsKeptWhereCodeFromOutsideIsRefused },
        { recordIsFrozenAtBirthUnderInspectorTest, recordIsFrozenAtBirthUnderInspector },
        { recordIsNotFrozenAheadOfDoorTest, recordIsNotFrozenAheadOfDoor },
    };
    return tests;
}

} } // namespace JSC::AOT

#endif // ENABLE(AOT)
