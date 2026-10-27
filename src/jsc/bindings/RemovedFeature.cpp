#include "root.h"
#include <JavaScriptCore/AOTRemovableFeature.h>

// JavaScriptCore asks the program that links it which of its features were removed from the executable.
// Nothing removes any from Bun, so nothing calls these functions.
namespace JSC {

extern "C" const char* Bun__removableFeatureName(uint16_t feature);

extern "C" const RemovableFeatureState Bun__removableFeatureState {};

extern "C" void Bun__abortForRemovedFeature(uint16_t)
{
    CRASH();
}

extern "C" EncodedJSValue Bun__throwForRemovedFeature(JSGlobalObject*, uint16_t)
{
    CRASH();
}

extern "C" EncodedJSValue Bun__throwForRemovedBuiltin(JSGlobalObject*, uint16_t, uint32_t)
{
    CRASH();
}

extern "C" EncodedJSValue Bun__throwForRemovedFunction(JSGlobalObject*, uint16_t, StringImpl*)
{
    CRASH();
}

extern "C" const char* Bun__removableFeatureName(uint16_t)
{
    return nullptr;
}

} // namespace JSC

#if ENABLE(AOT)

#include <JavaScriptCore/AOTBuiltinTable.h>
#include <JavaScriptCore/AOTRuntimeDescription.h>

// The debug and ASAN builds of WebKit have JavaScriptCore's ahead-of-time compiler, which leaves its table of
// built-ins to the program that links it. Only the compiler and the code it compiled read the table, and Bun uses
// neither (Options::useAOT() is off), so the table is empty.
namespace JSC {
namespace AOT {

struct BuiltinClassTokenStorage : BuiltinTextStorage<1, 1> {};

const BuiltinTableData builtinTableData {};
const BuiltinClassTokenStorage builtinTableClassTokens {};
extern "C" AOT_KEPT_BY_EVERY_LINKER const BuiltinTableDescription describedBuiltinTable {};

#define EMPTY_POOL(pool, Record, array) const Record array[0] {};
FOR_EACH_AOT_BUILTIN_RECORD_POOL(EMPTY_POOL)
#undef EMPTY_POOL

#define EMPTY_LIST(ID, array, count)                \
    inline namespace AOT_NAMESPACE_OF_ENGINE_LIST { \
    const ID array[count] {};                       \
    }
FOR_EACH_AOT_LIST_OF_NAMED_IDS(EMPTY_LIST)
#undef EMPTY_LIST

const BuiltinResult builtinTableResultsOfOverloads[0] {};
const BuiltinEffects builtinTableEffectsOfOverloads[0] {};
const BuiltinFlow builtinTableFlowsOfOverloads[0] {};
const BuiltinCode builtinTableCodeOfOverloads[0] {};
const BuiltinPackedOverload builtinTableOverloads[0] {};
const BuiltinDispatch builtinTableDispatches[0] {};
const BuiltinDispatchNode builtinTableDispatchNodes[0] {};
const BuiltinType builtinTableTypes[0] {};
const BuiltinFeatureUse builtinTableFeatureUses[0] {};
const BuiltinModuleLoad builtinTableModuleLoads[0] {};
const BuiltinCalledFunction builtinTableCalledFunctions[0] {};
const BuiltinCalledFunction builtinTableStartupCalledFunctions[0] {};
const BuiltinHostObject builtinTableHostObjects[0] {};
const BuiltinNamedMemberCall builtinTableNamedMemberCalls[0] {};
const BuiltinHostMethodCall builtinTableHostMethodCalls[0] {};
const BuiltinForms builtinTableForms[0] {};
const BuiltinNameClasses builtinTableClassesByMemberName[0] {};

} // namespace AOT
} // namespace JSC

#endif // ENABLE(AOT)
