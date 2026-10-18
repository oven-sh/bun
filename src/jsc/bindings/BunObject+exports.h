#pragma once
// clang-format off

// --- Getters ---
#define FOR_EACH_GETTER(macro) \
    macro(Archive) \
    macro(FFI) \
    macro(FetchSession) \
    macro(FileSystemRouter) \
    macro(Image) \
    macro(markdown) \
    macro(S3Client) \
    macro(Terminal) \
    macro(Transpiler) \
    macro(ValkeyClient) \
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

// --- Callbacks ---
#define FOR_EACH_CALLBACK(macro) \
    macro(build) \
    macro(color) \
    macro(connect) \
    macro(createParsedShellScript) \
    macro(createShellInterpreter) \
    macro(file) \
    macro(jest) \
    macro(listen) \
    macro(resolve) \
    macro(resolveSync) \
    macro(serve) \
    macro(spawn) \
    macro(spawnSync) \
    macro(udpSocket) \
    macro(write) \

#define DECLARE_ZIG_BUN_OBJECT_CALLBACK(name) BUN_DECLARE_HOST_FUNCTION(BunObject_callback_##name);
FOR_EACH_CALLBACK(DECLARE_ZIG_BUN_OBJECT_CALLBACK);
#undef DECLARE_ZIG_BUN_OBJECT_CALLBACK

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
#undef FOR_EACH_CALLBACK
