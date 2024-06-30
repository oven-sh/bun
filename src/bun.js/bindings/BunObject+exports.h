#pragma once
// clang-format off

// --- Getters ---
#define FOR_EACH_GETTER(macro) \
    macro(CryptoHasher) \
    macro(FFI) \
    macro(FileSystemRouter) \
    macro(Glob) \
    macro(MD4) \
    macro(MD5) \
    macro(SHA1) \
    macro(SHA224) \
    macro(SHA256) \
    macro(SHA384) \
    macro(SHA512) \
    macro(SHA512_256) \
    macro(TOML) \
    macro(Transpiler) \
    macro(argv) \
    macro(assetPrefix) \
    macro(cwd) \
    macro(enableANSIColors) \
    macro(hash) \
    macro(inspect) \
    macro(main) \
    macro(origin) \
    macro(stderr) \
    macro(stdin) \
    macro(stdout) \
    macro(unsafe) \
    macro(semver) \

// --- Callbacks ---
#define FOR_EACH_CALLBACK(macro) \
    macro(allocUnsafe) \
    macro(braces) \
    macro(build) \
    macro(connect) \
    macro(deflateSync) \
    macro(file) \
    macro(fs) \
    macro(gc) \
    macro(generateHeapSnapshot) \
    macro(gunzipSync) \
    macro(gzipSync) \
    macro(indexOfLine) \
    macro(inflateSync) \
    macro(jest) \
    macro(listen) \
    macro(udpSocket) \
    macro(mmap) \
    macro(nanoseconds) \
    macro(openInEditor) \
    macro(registerMacro) \
    macro(resolve) \
    macro(resolveSync) \
    macro(serve) \
    macro(sha) \
    macro(shrink) \
    macro(sleepSync) \
    macro(spawn) \
    macro(spawnSync) \
    macro(which) \
    macro(write) \
    macro(stringWidth) \
    macro(shellEscape) \
    macro(createShellInterpreter) \
    macro(createParsedShellScript) \

#define DECLARE_ZIG_BUN_OBJECT_CALLBACK(name) BUN_DECLARE_HOST_FUNCTION(BunObject_callback_##name);
FOR_EACH_CALLBACK(DECLARE_ZIG_BUN_OBJECT_CALLBACK);
#undef DECLARE_ZIG_BUN_OBJECT_CALLBACK

#define DECLARE_ZIG_BUN_OBJECT_GETTER(name) extern "C" JSC::EncodedJSValue SYSV_ABI BunObject_getter_##name(JSC::JSGlobalObject*, JSC::JSObject*);
FOR_EACH_GETTER(DECLARE_ZIG_BUN_OBJECT_GETTER);
#undef DECLARE_ZIG_BUN_OBJECT_GETTER

#define DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER(name) static JSC::JSValue BunObject_getter_wrap_##name(JSC::VM &vm, JSC::JSObject *object) { \
    return JSC::JSValue::decode(BunObject_getter_##name(object->globalObject(), object)); \
} \

FOR_EACH_GETTER(DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER);
#undef DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER

#undef FOR_EACH_GETTER
#undef FOR_EACH_CALLBACK
