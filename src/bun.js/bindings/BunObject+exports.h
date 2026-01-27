#pragma once
// clang-format off

// --- Getters ---
#define FOR_EACH_GETTER(macro) \
    macro(Archive) \
    macro(CSRF) \
    macro(CryptoHasher) \
    macro(FFI) \
    macro(FileSystemRouter) \
    macro(Glob) \
    macro(JSON5) \
    macro(JSONC) \
    macro(MD4) \
    macro(MD5) \
    macro(S3Client) \
    macro(SHA1) \
    macro(SHA224) \
    macro(SHA256) \
    macro(SHA384) \
    macro(SHA512) \
    macro(SHA512_256) \
    macro(TOML) \
    macro(YAML) \
    macro(Terminal) \
    macro(Transpiler) \
    macro(ValkeyClient) \
    macro(argv) \
    macro(assetPrefix) \
    macro(cwd) \
    macro(embeddedFiles) \
    macro(enableANSIColors) \
    macro(hash) \
    macro(inspect) \
    macro(origin) \
    macro(s3) \
    macro(semver) \
    macro(unsafe) \
    macro(valkey) \

// --- Callbacks ---
#define FOR_EACH_CALLBACK(macro) \
    macro(allocUnsafe) \
    macro(braces) \
    macro(build) \
    macro(color) \
    macro(connect) \
    macro(createParsedShellScript) \
    macro(createShellInterpreter) \
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
    macro(mmap) \
    macro(nanoseconds) \
    macro(openInEditor) \
    macro(registerMacro) \
    macro(resolve) \
    macro(resolveSync) \
    macro(serve) \
    macro(sha) \
    macro(shellEscape) \
    macro(shrink) \
    macro(sleepSync) \
    macro(spawn) \
    macro(spawnSync) \
    macro(stringWidth) \
    macro(udpSocket) \
    macro(which) \
    macro(write) \
    macro(zstdCompressSync) \
    macro(zstdDecompressSync) \
    macro(zstdCompress) \
    macro(zstdDecompress) \

#define DECLARE_ZIG_BUN_OBJECT_CALLBACK(name) BUN_DECLARE_HOST_FUNCTION(BunObject_callback_##name);
FOR_EACH_CALLBACK(DECLARE_ZIG_BUN_OBJECT_CALLBACK);
#undef DECLARE_ZIG_BUN_OBJECT_CALLBACK

// declaration for the exported function in BunObject.zig
#define DECLARE_ZIG_BUN_OBJECT_GETTER(name) extern "C" JSC::EncodedJSValue SYSV_ABI BunObject_lazyPropCb_##name(JSC::JSGlobalObject*, JSC::JSObject*);
FOR_EACH_GETTER(DECLARE_ZIG_BUN_OBJECT_GETTER);
#undef DECLARE_ZIG_BUN_OBJECT_GETTER

// definition of the C++ wrapper to call the Zig function
#define DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER(name) static JSC::JSValue BunObject_lazyPropCb_wrap_##name(JSC::VM &vm, JSC::JSObject *object) { \
    return JSC::JSValue::decode(BunObject_lazyPropCb_##name(object->globalObject(), object)); \
} \

FOR_EACH_GETTER(DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER);
#undef DEFINE_ZIG_BUN_OBJECT_GETTER_WRAPPER

#undef FOR_EACH_GETTER
#undef FOR_EACH_CALLBACK
