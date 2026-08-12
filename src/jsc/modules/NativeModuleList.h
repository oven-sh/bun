// clang-format off
#pragma once

// The list of native synthetic modules and the enum derived from it.
// Split out so ZigGlobalObject.h can size its cache array without pulling
// in _NativeModule.h (which includes ZigGlobalObject.h).

#define BUN_FOREACH_ESM_AND_CJS_NATIVE_MODULE(macro) \
    macro("bun:test"_s, BunTest) \
    macro("bun:jsc"_s, BunJSC) \
    macro("bun:app"_s, BunApp) \
    macro("node:buffer"_s, NodeBuffer) \
    macro("node:constants"_s, NodeConstants) \
    macro("node:sqlite"_s, NodeSqlite) \
    macro("node:string_decoder"_s, NodeStringDecoder) \
    macro("node:util/types"_s, NodeUtilTypes)  \
    macro("utf-8-validate"_s, UTF8Validate) \
    macro("abort-controller"_s, AbortControllerModule)

#define BUN_FOREACH_ESM_NATIVE_MODULE(macro) \
    BUN_FOREACH_ESM_AND_CJS_NATIVE_MODULE(macro)

// Generators with JSC::SyntheticSourceProvider::LazySyntheticSourceGenerator's signature: they may
// declare exports without a value and return the object JSC reads those exports from on first binding
// (see exportObjectProperties in _NativeModule.h). src/codegen/internal-module-registry-scanner.ts
// numbers native modules by their order in this file, so these stay after the list above, in this order.
#define BUN_FOREACH_LAZY_ESM_NATIVE_MODULE(macro) \
    macro("node:module"_s, NodeModule)  \
    macro("node:process"_s, NodeProcess) \
    macro("bun"_s, BunObject)

#define BUN_FOREACH_CJS_NATIVE_MODULE(macro) \
    BUN_FOREACH_ESM_AND_CJS_NATIVE_MODULE(macro)

namespace Zig {
// Slot index into GlobalObject::m_nativeModuleDefaults. The generator runs once per
// registry (ESM vs CJS); INIT_NATIVE_MODULE reads/writes this slot so both see one object.
enum class NativeModuleDefaultSlot : unsigned char {
#define NATIVE_MODULE_SLOT(id, enumName) enumName,
BUN_FOREACH_ESM_NATIVE_MODULE(NATIVE_MODULE_SLOT)
BUN_FOREACH_LAZY_ESM_NATIVE_MODULE(NATIVE_MODULE_SLOT)
#undef NATIVE_MODULE_SLOT
    Count
};
static constexpr unsigned NativeModuleDefaultSlotCount = static_cast<unsigned>(NativeModuleDefaultSlot::Count);
}
