#pragma once
#include "wtf/Compiler.h"
#include "wtf/text/OrdinalNumber.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/ArgList.h"
#include <wtf/Noncopyable.h>
#include <wtf/Vector.h>
#include <set>

#ifndef HEADERS_HANDWRITTEN
#define HEADERS_HANDWRITTEN
typedef struct VirtualMachine VirtualMachine;
// exists to make headers.h happy
typedef struct CppWebSocket CppWebSocket;

namespace WTF {
class String;
}

typedef struct EncodedSlice {
    const unsigned char* ptr;
    size_t len;
} EncodedSlice;

#ifndef __cplusplus
typedef uint8_t BunStringTag;
typedef union BunStringImpl {
    EncodedSlice encoded;
    void* wtf;
} BunStringImpl;

#else
namespace WTF {
class StringImpl;
class String;
}

typedef union BunStringImpl {
    EncodedSlice encoded;
    WTF::StringImpl* wtf;
} BunStringImpl;

enum class BunStringTag : uint8_t {
    Dead = 0,
    WTFStringImpl = 1,
    EncodedSlice = 2,
    StaticEncodedSlice = 3,
    Empty = 4,
    // A constructor could not allocate the string. Holds no string like Dead,
    // but reaches JS as ERR_MEMORY_ALLOCATION_FAILED, not ERR_STRING_TOO_LONG.
    OutOfMemory = 5,
};

/// Mirrors `ErrorKind` in src/jsc/bun_string_jsc.rs.
enum class BunErrorKind : uint8_t {
    Error = 0,
    TypeError = 1,
    SyntaxError = 2,
    RangeError = 3,
};

/// Mirrors `ResponseKind` in src/uws/lib.rs.
enum class UWSResponseKind : int32_t {
    TCP = 0,
    SSL = 1,
    H2 = 2,
    H3 = 3,
};
#endif

typedef struct BunString {
    BunStringTag tag;
    BunStringImpl impl;

    enum ZeroCopyTag { ZeroCopy };
    enum NonNullTag { NonNull };

    // If it's not a WTFStringImpl, this does nothing
    inline void ref();

    // If it's not a WTFStringImpl, this does nothing
    inline void deref();

    // Zero copy is kind of a lie.
    // We clone it if it's non-ASCII UTF-8.
    // We don't clone it if it was marked as static
    // if it was an EncodedSlice, it still allocates a WTF::StringImpl.
    // It's only truly zero-copy if it was already a WTFStringImpl (which it is if it came from JS and we didn't use EncodedSlice)
    WTF::String toWTFString(ZeroCopyTag) const;

    // If the string is empty, this will ensure m_impl is non-null by
    // using shared static emptyString.
    WTF::String toWTFString(NonNullTag) const;

    WTF::String transferToWTFString();

    // Consumes this BunString and returns a JS string value. Leaves *this Dead
    // so a Rust-side OwnedString::Drop deref becomes a no-op.
    JSC::JSValue transferToJS(JSC::JSGlobalObject* globalObject);

    // This one usually will clone the raw bytes.
    WTF::String toWTFString() const;

    bool isEmpty() const;

    // Dead or OutOfMemory: no string at all. Empty is a string.
    bool isDead() const { return tag == BunStringTag::Dead || tag == BunStringTag::OutOfMemory; }

    void appendToBuilder(WTF::StringBuilder& builder) const;

} BunString;

typedef union ErrorableStringResult {
    BunString value;
    JSC::EncodedJSValue err;
} ErrorableStringResult;
typedef struct ErrorableString {
    ErrorableStringResult result {};
    bool success { false };
} ErrorableString;
static_assert(sizeof(ErrorableString) == 32 && alignof(ErrorableString) == 8, "ErrorableString layout is mirrored in src/jsc/Errorable.rs");
struct bun_ModuleInfoDeserialized;
// Every BunString here is owned by whichever frame holds the struct (see
// ~ErrorableResolvedSource / Rust `Drop`). Consumers that keep a string take it
// with `transferToWTFString()`, which leaves the field empty.
typedef struct ResolvedSource {
    BunString source_code;
    BunString source_url;
    bool isCommonJSModule;
    // `bun build --compile`: StringImpl::hash() of source_code computed at build time (0 = unknown).
    uint32_t source_code_hash;
    JSC::EncodedJSValue cjsCustomExtension;
    JSC::EncodedJSValue jsvalue_for_export;
    uint32_t tag;
    bool already_bundled;
    // -- Bytecode cache fields --
    // Owned (`ResolvedSource__freeBytecode`) iff `bytecode_cache_owned`; otherwise
    // borrowed from the standalone module graph / compile cache.
    uint8_t* bytecode_cache;
    size_t bytecode_cache_size;
    bool bytecode_cache_owned;
    // The bytes outlive every VM (executable section / retired compile-cache blob): JSC may alias them.
    bool bytecode_cache_persistent;
    // Owned; Zig::SourceProvider takes it (nulling the field).
    bun_ModuleInfoDeserialized* module_info;
    // File path whose file:// URL is the source origin (what import() resolves against, what a bytecode cache is
    // validated against). If empty, origin is derived from source_url.
    BunString origin_path;
} ResolvedSource;
static_assert(sizeof(ResolvedSource) == 136, "ResolvedSource layout is mirrored in src/jsc/ResolvedSource.rs");
inline constexpr uint32_t ResolvedSourceTagPackageJSONTypeModule = 1;
typedef union ErrorableResolvedSourceResult {
    ResolvedSource value;
    JSC::EncodedJSValue err;
} ErrorableResolvedSourceResult;
extern "C" void zig__ModuleInfoDeserialized__deinit(bun_ModuleInfoDeserialized* info);
extern "C" void ResolvedSource__freeBytecode(uint8_t* bytecode);
struct ErrorableResolvedSource {
    WTF_MAKE_NONCOPYABLE(ErrorableResolvedSource);

public:
    ErrorableResolvedSourceResult result {};
    bool success { false };

    ErrorableResolvedSource() = default;
    ~ErrorableResolvedSource()
    {
        if (!success)
            return;
        result.value.source_code.deref();
        result.value.source_url.deref();
        result.value.origin_path.deref();
        if (result.value.bytecode_cache_owned && result.value.bytecode_cache)
            ResolvedSource__freeBytecode(result.value.bytecode_cache);
        if (result.value.module_info)
            zig__ModuleInfoDeserialized__deinit(result.value.module_info);
    }
};
static_assert(sizeof(ErrorableResolvedSource) == 144 && alignof(ErrorableResolvedSource) == 8, "ErrorableResolvedSource layout is mirrored in src/jsc/Errorable.rs");

typedef struct SystemError {
    int errno_;
    BunString code;
    BunString message;
    BunString path;
    BunString syscall;
    BunString hostname;
    /// MinInt if not specified
    int fd;
    BunString dest;
} SystemError;

typedef void* ArrayBufferSink;

typedef uint8_t BunPluginTarget;
inline constexpr BunPluginTarget BunPluginTargetBun = 0;
inline constexpr BunPluginTarget BunPluginTargetBrowser = 1;
inline constexpr BunPluginTarget BunPluginTargetNode = 2;
inline constexpr BunPluginTarget BunPluginTargetMax = BunPluginTargetNode;

typedef uint8_t ZigStackFrameCode;
inline constexpr ZigStackFrameCode ZigStackFrameCodeNone = 0;
inline constexpr ZigStackFrameCode ZigStackFrameCodeEval = 1;
inline constexpr ZigStackFrameCode ZigStackFrameCodeModule = 2;
inline constexpr ZigStackFrameCode ZigStackFrameCodeFunction = 3;
inline constexpr ZigStackFrameCode ZigStackFrameCodeGlobal = 4;
inline constexpr ZigStackFrameCode ZigStackFrameCodeWasm = 5;
inline constexpr ZigStackFrameCode ZigStackFrameCodeConstructor = 6;

extern "C" void __attribute((__noreturn__)) Bun__panic(const char* message, size_t length);
#define BUN_PANIC(message) Bun__panic(message, sizeof(message) - 1)

typedef struct ZigStackFramePosition {
    int32_t line_zero_based;
    int32_t column_zero_based;
    int32_t byte_position;

    ALWAYS_INLINE WTF::OrdinalNumber column()
    {
        return OrdinalNumber::fromZeroBasedInt(this->column_zero_based);
    }
    ALWAYS_INLINE WTF::OrdinalNumber line()
    {
        return OrdinalNumber::fromZeroBasedInt(this->line_zero_based);
    }
} ZigStackFramePosition;

typedef struct ZigStackFrame {
    BunString function_name;
    BunString source_url;
    ZigStackFramePosition position;
    ZigStackFrameCode code_type;
    bool is_async;
    bool remapped;
    int32_t jsc_stack_frame_index;

    ZigStackFrame()
        : function_name {}
        , source_url {}
        , position {}
        , code_type {}
        , is_async(false)
        , remapped(false)
        , jsc_stack_frame_index(-1)
    {
    }
} ZigStackFrame;

typedef struct ZigStackTrace {
    BunString* source_lines_ptr;
    OrdinalNumber* source_lines_numbers;
    uint8_t source_lines_len;
    uint8_t source_lines_to_collect;
    ZigStackFrame* frames_ptr;
    uint8_t frames_len;
    uint8_t frames_cap;
    JSC::SourceProvider* referenced_source_provider;
} ZigStackTrace;

typedef struct ZigException {
    unsigned char type;
    uint16_t runtime_type;
    int errno_;
    BunString syscall;
    BunString system_code;
    BunString path;
    BunString name;
    BunString message;
    ZigStackTrace stack;
    void* exception;
    bool remapped;
    int fd;
} ZigException;

typedef uint8_t JSErrorCode;
inline constexpr JSErrorCode JSErrorCodeError = 0;
inline constexpr JSErrorCode JSErrorCodeEvalError = 1;
inline constexpr JSErrorCode JSErrorCodeRangeError = 2;
inline constexpr JSErrorCode JSErrorCodeReferenceError = 3;
inline constexpr JSErrorCode JSErrorCodeSyntaxError = 4;
inline constexpr JSErrorCode JSErrorCodeTypeError = 5;
inline constexpr JSErrorCode JSErrorCodeURIError = 6;
inline constexpr JSErrorCode JSErrorCodeAggregateError = 7;
inline constexpr JSErrorCode JSErrorCodeOutOfMemoryError = 8;
inline constexpr JSErrorCode JSErrorCodeStackOverflow = 253;
inline constexpr JSErrorCode JSErrorCodeUserErrorCode = 254;

// Must be kept in sync with Loader in src/options_types/schema.rs
typedef uint8_t BunLoaderType;
inline constexpr BunLoaderType BunLoaderTypeNone = 254;
inline constexpr BunLoaderType BunLoaderTypeJSX = 1;
inline constexpr BunLoaderType BunLoaderTypeJS = 2;
inline constexpr BunLoaderType BunLoaderTypeTS = 3;
inline constexpr BunLoaderType BunLoaderTypeTSX = 4;
inline constexpr BunLoaderType BunLoaderTypeCSS = 5;
inline constexpr BunLoaderType BunLoaderTypeFILE = 6;
inline constexpr BunLoaderType BunLoaderTypeJSON = 7;
inline constexpr BunLoaderType BunLoaderTypeJSONC = 8;
inline constexpr BunLoaderType BunLoaderTypeTOML = 9;
inline constexpr BunLoaderType BunLoaderTypeWASM = 10;
inline constexpr BunLoaderType BunLoaderTypeNAPI = 11;
inline constexpr BunLoaderType BunLoaderTypeYAML = 19;
inline constexpr BunLoaderType BunLoaderTypeMD = 21;
inline constexpr BunLoaderType BunLoaderTypeXML = 22;

#pragma mark - Stream

typedef uint8_t Encoding;
inline constexpr Encoding Encoding__utf8 = 0;
inline constexpr Encoding Encoding__ucs2 = 1;
inline constexpr Encoding Encoding__utf16le = 2;
inline constexpr Encoding Encoding__latin1 = 3;
inline constexpr Encoding Encoding__ascii = 4;
inline constexpr Encoding Encoding__base64 = 5;
inline constexpr Encoding Encoding__base64url = 6;
inline constexpr Encoding Encoding__hex = 7;
inline constexpr Encoding Encoding__buffer = 8;

#ifndef STRING_POINTER
#define STRING_POINTER
typedef struct StringPointer {
    uint32_t off;
    uint32_t len;
} StringPointer;
#endif

typedef void WebSocketHTTPClient;
typedef void WebSocketHTTPSClient;
typedef void WebSocketClient;
typedef void WebSocketClientTLS;

#ifndef __cplusplus
typedef struct Bun__ArrayBuffer Bun__ArrayBuffer;
typedef struct JSC::JSUint8Array JSC::JSUint8Array;
#endif

#ifdef __cplusplus

extern "C" void Bun__WTFStringImpl__destroy(WTF::StringImpl* impl);
extern "C" bool BunString__fromJS(JSC::JSGlobalObject*, JSC::EncodedJSValue, BunString*);
extern "C" JSC::EncodedJSValue BunString__toJS(JSC::JSGlobalObject*, const BunString*);

namespace Bun {
JSC::JSString* toJS(JSC::JSGlobalObject*, BunString);
BunString toString(WTF::String& wtfString);
BunString toString(const WTF::String& wtfString);
BunString toString(WTF::StringImpl* wtfString);

BunString toStringRef(JSC::JSGlobalObject* globalObject, JSC::JSValue value);
BunString toStringRef(WTF::String& wtfString);
BunString toStringRef(const WTF::String& wtfString);
BunString toStringRef(WTF::StringImpl* wtfString);

// This creates a detached string view, which cannot be ref/unref.
// Be very careful using this, and ensure the memory owner does not get destroyed.
BunString toStringView(WTF::StringView view);
}

typedef struct {
    char* ptr;
    size_t len;
    size_t byte_len;
    int64_t _value;
    uint8_t cell_type;
    bool shared;
    bool resizable;
    bool pinned;
} Bun__ArrayBuffer;

#include "SyntheticModuleType.h"

extern "C" const char* Bun__userAgent;

extern "C" bool Bun__transpileVirtualModule(
    JSC::JSGlobalObject* global,
    const BunString* specifier,
    const BunString* referrer,
    const EncodedSlice* sourceCode,
    BunLoaderType loader,
    ErrorableResolvedSource* result);

extern "C" JSC::EncodedJSValue Bun__runVirtualModule(
    JSC::JSGlobalObject* global,
    const BunString* specifier);

extern "C" JSC::JSPromise* Bun__transpileFile(
    void* bunVM,
    JSC::JSGlobalObject* global,
    const BunString* specifier,
    const BunString* referrer,
    const BunString* typeAttribute,
    ErrorableResolvedSource* result,
    bool allowPromise,
    bool isCommonJSRequire,
    BunLoaderType forceLoaderType);

extern "C" bool Bun__fetchBuiltinModule(
    void* bunVM,
    JSC::JSGlobalObject* global,
    const BunString* specifier,
    ErrorableResolvedSource* result);
extern "C" bool Bun__resolveAndFetchBuiltinModule(
    const BunString* specifier,
    ErrorableResolvedSource* result);
extern "C" bool Bun__VM__useIsolationSourceProviderCache(void* bunVM);

// Used in process.version
extern "C" const char* Bun__version;
extern "C" const char* Bun__version_with_sha;

extern "C" const char* Bun__version_sha;

extern "C" void EncodedSlice__freeGlobal(const unsigned char* ptr, size_t len);

// `to[..other_len]` (ArrayBuffer storage) never overlaps `ptr[..len]` (a JS string's characters);
// the Rust side copies with memcpy semantics.
extern "C" size_t Bun__encoding__writeLatin1(const unsigned char* ptr, size_t len, unsigned char* to, size_t other_len, Encoding encoding);
extern "C" size_t Bun__encoding__writeUTF16(const char16_t* ptr, size_t len, unsigned char* to, size_t other_len, Encoding encoding);

extern "C" size_t Bun__encoding__byteLengthLatin1AsUTF8(const unsigned char* ptr, size_t len);
extern "C" size_t Bun__encoding__byteLengthUTF16AsUTF8(const char16_t* ptr, size_t len);

extern "C" JSC::EncodedJSValue Bun__encoding__constructFromLatin1(void*, const unsigned char* ptr, size_t len, Encoding encoding);
extern "C" JSC::EncodedJSValue Bun__encoding__constructFromUTF16(void*, const char16_t* ptr, size_t len, Encoding encoding);

extern "C" void Bun__EventLoop__runCallback2(JSC::JSGlobalObject* global, JSC::EncodedJSValue callback, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue arg1, JSC::EncodedJSValue arg2);

/// @note throws a JS exception and returns false if a stack overflow occurs
template<bool isStrict, bool enableAsymmetricMatchers, bool checkPrototypes, bool skipPrototypeIdentity = false>
bool Bun__deepEquals(JSC::JSGlobalObject* globalObject, JSC::JSValue v1, JSC::JSValue v2, JSC::MarkedArgumentBuffer&, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, JSC::ThrowScope& scope, bool addToStack);

/**
 * @brief `Bun.deepMatch(a, b)`
 *
 * `object` and `subset` must be objects. In the future we should change the
 * signature of this function to only take `JSC::JSCell`. For now, panics
 * if either `object` or `subset` are not `JSCCell`.
 *
 * @note
 * The sets recording already visited properties (`seenObjProperties` and
 * `seenSubsetProperties`) aren not needed when both `enableAsymmetricMatchers`
 * and `isMatchingObjectContaining` are true. In this case, it is safe to pass a
 * `nullptr`.
 *
 * `gcBuffer` ensures JSC's stack scan does not come up empty-handed and free
 * properties currently within those stacks. Likely unnecessary, but better to
 * be safe tnan sorry
 *
 *
 * @tparam enableAsymmetricMatchers
 * @param objValue
 * @param seenObjProperties already visited properties of `objValue`.
 * @param subsetValue
 * @param seenSubsetProperties already visited properties of `subsetValue`.
 * @param globalObject
 * @param Scope
 * @param gcBuffer
 * @param replacePropsWithAsymmetricMatchers
 * @param isMatchingObjectContaining
 *
 * @return true
 * @return false
 */
template<bool enableAsymmetricMatchers>
bool Bun__deepMatch(
    JSC::JSValue object,
    std::set<JSC::EncodedJSValue>* seenObjProperties,
    JSC::JSValue subset,
    std::set<JSC::EncodedJSValue>* seenSubsetProperties,
    JSC::JSGlobalObject* globalObject,
    JSC::ThrowScope& throwScope,
    JSC::MarkedArgumentBuffer* gcBuffer,
    bool replacePropsWithAsymmetricMatchers,
    bool isMatchingObjectContaining);

extern "C" void Bun__remapStackFramePositions(void*, ZigStackFrame*, size_t);

namespace Inspector {
class ScriptArguments;
}

using ScriptArguments = Inspector::ScriptArguments;

ALWAYS_INLINE void BunString::ref()
{
    if (this->tag == BunStringTag::WTFStringImpl) {
        this->impl.wtf->ref();
    }
}
ALWAYS_INLINE void BunString::deref()
{
    if (this->tag == BunStringTag::WTFStringImpl) {
        this->impl.wtf->deref();
    }
}

namespace Bun {

// Frames built here for Bun__remapStackFramePositions, which may swap in a freshly allocated source_url; frames behind ZigStackTrace::frames_ptr are released by Rust instead.
class OwnedZigStackFrames {
    WTF_MAKE_NONCOPYABLE(OwnedZigStackFrames);

public:
    explicit OwnedZigStackFrames(size_t count)
        : m_frames(count)
    {
    }

    ~OwnedZigStackFrames()
    {
        for (ZigStackFrame& frame : m_frames) {
            frame.function_name.deref();
            frame.source_url.deref();
        }
    }

    ZigStackFrame& operator[](size_t index) { return m_frames[index]; }

    void remap(void* bunVM)
    {
        Bun__remapStackFramePositions(bunVM, m_frames.begin(), m_frames.size());
    }

private:
    WTF::Vector<ZigStackFrame, 8> m_frames;
};

} // namespace Bun

#define CLEAR_IF_EXCEPTION(scope__) (void)scope__.tryClearException();

#endif // __cplusplus
#endif // HEADERS_HANDWRITTEN

#if ASSERT_ENABLED
#define ASSERT_NO_PENDING_EXCEPTION(globalObject) DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm()).assertNoExceptionExceptTermination()
#else
#define ASSERT_NO_PENDING_EXCEPTION(globalObject) void()
#endif

#if ASSERT_ENABLED
#define ASSERT_PENDING_EXCEPTION(globalObject) EXCEPTION_ASSERT(!!DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm()).exception());
#else
#define ASSERT_PENDING_EXCEPTION(globalObject) void()
#endif
