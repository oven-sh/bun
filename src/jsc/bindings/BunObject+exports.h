#pragma once
// clang-format off

// --- Getters ---
#define FOR_EACH_GETTER(macro) \
    macro(FFI) \
    macro(argv) \
    macro(cron) \
    macro(cwd) \
    macro(embeddedFiles) \
    macro(enableANSIColors) \
    macro(inspect) \
    macro(isStandaloneExecutable) \
    macro(origin) \
    macro(s3) \
    macro(valkey) \

// declaration for the exported function in src/runtime/api/BunObject.rs
#define DECLARE_ZIG_BUN_OBJECT_GETTER(name) extern "C" JSC::EncodedJSValue SYSV_ABI BunObject_lazyPropCb_##name(JSC::JSGlobalObject*, JSC::JSObject*);
FOR_EACH_GETTER(DECLARE_ZIG_BUN_OBJECT_GETTER);
#undef DECLARE_ZIG_BUN_OBJECT_GETTER

// definition of the C++ wrapper to call the Rust function
#define DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER(name) static JSC::JSValue BunObject_lazyPropCb_wrap_##name(JSC::VM &vm, JSC::JSObject *object) { \
    return JSC::JSValue::decode(BunObject_lazyPropCb_##name(object->globalObject(), object)); \
} \

FOR_EACH_GETTER(DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER);
#undef DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER

#undef FOR_EACH_GETTER
