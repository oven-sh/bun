#pragma once

// Names and small types that the other headers share.

#include "engine/Support.h"

#include "EngineConstants.h"
#include "engine/api/Layout.h"

#define ENGINE_STRINGIFY_EXPANDED(text) #text
#define ENGINE_STRINGIFY(text) ENGINE_STRINGIFY_EXPANDED(text)
// Makes a declaration refer to what Rust defines under that name.
#define ENGINE_SYMBOL(name) __asm__(ENGINE_STRINGIFY(__USER_LABEL_PREFIX__) #name)
#define ENGINE_CHECK_OFFSET(type, member, offset) static_assert(OBJECT_OFFSETOF(type, member) == Engine::Layout::offset)
#define ENGINE_CHECK_SIZE(type, size) static_assert(sizeof(type) == Engine::Layout::size)

#ifndef JS_EXPORT_PRIVATE
#define JS_EXPORT_PRIVATE
#endif
#ifndef JS_EXPORT
#define JS_EXPORT __attribute__((visibility("default")))
#endif

namespace Engine {

template<typename T> ALWAYS_INLINE T& fieldAt(const void* base, ptrdiff_t offset)
{
    return *reinterpret_cast<T*>(reinterpret_cast<uintptr_t>(base) + offset);
}

// Room for fields that only Rust uses.
template<size_t size> struct alignas(size % 8 ? 1 : 8) Opaque {
    unsigned char bytes[size];
};

} // namespace Engine

namespace Inspector {
enum class AsyncCallType : uint8_t;
}

namespace JSC {

class AbstractSlotVisitor;
class ArgList;
class ArrayAllocationProfile;
class ArrayBuffer;
class Butterfly;
class CallFrame;
class CodeBlock;
class CompleteSubspace;
class ConsoleClient;
class CustomGetterSetter;
class DeletePropertySlot;
class ErrorInstance;
class Exception;
class ExceptionScope;
class ExecutableBase;
class FunctionExecutable;
class GCDeferralContext;
class GetterSetter;
class Heap;
class HeapAnalyzer;
class HeapCell;
class Identifier;
class InternalFieldTuple;
class InternalFunction;
class IsoSubspace;
class JSArray;
class JSArrayBuffer;
class JSArrayBufferView;
class JSBigInt;
class JSBoundFunction;
class JSCell;
class JSCellButterfly;
class JSDestructibleObject;
class JSFinalObject;
class JSFunction;
class JSGlobalObject;
class JSGlobalProxy;
class JSModuleLoader;
class JSNonFinalObject;
class JSObject;
class JSPromise;
class JSScope;
class JSString;
class JSValue;
class NativeExecutable;
class ObjectInitializationScope;
class ParserError;
class PrivateName;
class PropertyDescriptor;
class PropertyName;
class PropertyNameArrayBuilder;
class PropertySlot;
class PutPropertySlot;
class ScriptExecutable;
class SlotVisitor;
class SourceCode;
class SourceOrigin;
class SourceProvider;
class StackFrame;
class StringObject;
class Structure;
class Symbol;
class ThrowScope;
class TopExceptionScope;
class VM;
class WeakHandleOwner;
class WeakImpl;
struct CallData;
struct ClassInfo;
struct GlobalObjectMethodTable;
struct HashTable;
struct HashTableValue;
struct MethodTable;

namespace GCClient {
using IsoSubspace = JSC::IsoSubspace;
}

using EncodedJSValue = int64_t;
using PropertyOffset = int;
using IndexingType = uint8_t;
using SourceID = intptr_t;
using BuiltinCode = FunctionExecutable*;

enum Unknown {};

template<typename T> class WriteBarrierBase;
template<typename T> class WriteBarrier;
template<typename T> class Handle;
template<typename T> class Strong;
template<typename T> class Weak;

// A pointer to a function that generated code may call.
template<typename Pointer> class HostFunctionPointer {
public:
    using Ptr = Pointer;

    constexpr HostFunctionPointer() = default;
    constexpr HostFunctionPointer(std::nullptr_t) {}
    constexpr HostFunctionPointer(Ptr pointer)
        : m_pointer(pointer)
    {
    }

    constexpr Ptr get() const { return m_pointer; }
    void* untaggedPtr() const { return reinterpret_cast<void*>(m_pointer); }
    explicit constexpr operator bool() const { return m_pointer; }
    friend constexpr bool operator==(HostFunctionPointer, HostFunctionPointer) = default;

private:
    Ptr m_pointer { nullptr };
};

using NativeFunction = HostFunctionPointer<EncodedJSValue(SYSV_ABI*)(JSGlobalObject*, CallFrame*)>;
using TaggedNativeFunction = NativeFunction;
using GetValueFunc = HostFunctionPointer<EncodedJSValue(SYSV_ABI*)(JSGlobalObject*, EncodedJSValue thisValue, PropertyName)>;
using PutValueFunc = HostFunctionPointer<bool(SYSV_ABI*)(JSGlobalObject*, EncodedJSValue thisValue, EncodedJSValue value, PropertyName)>;

inline TaggedNativeFunction toTagged(NativeFunction function) { return function; }

enum PreferredPrimitiveType : uint8_t {
    NoPreference = Engine::PreferredType::None,
    PreferNumber = Engine::PreferredType::Number,
    PreferString = Engine::PreferredType::String,
};

enum class DontEnumPropertiesMode : uint8_t {
    Include = Engine::DontEnumMode::Include,
    Exclude = Engine::DontEnumMode::Exclude,
};

enum class PropertyNameMode : uint8_t {
    Symbols = Engine::PropertyNameMode::Symbols,
    Strings = Engine::PropertyNameMode::Strings,
    StringsAndSymbols = Engine::PropertyNameMode::StringsAndSymbols,
};

enum class PrivateSymbolMode : bool { Include,
    Exclude };

enum PutDirectIndexMode : uint8_t {
    PutDirectIndexLikePutDirect = Engine::PutDirectIndexMode::LikePutDirect,
    PutDirectIndexShouldNotThrow = Engine::PutDirectIndexMode::ShouldNotThrow,
    PutDirectIndexShouldThrow = Engine::PutDirectIndexMode::ShouldThrow,
};

enum class Intrinsic : uint16_t {
    NoIntrinsic = Engine::Intrinsic::None,
    BufferAccessorIntrinsic = Engine::Intrinsic::BufferAccessor,
    ClockIntrinsic = Engine::Intrinsic::Clock,
    JSMapEntriesIntrinsic = Engine::Intrinsic::MapEntries,
    JSSetValuesIntrinsic = Engine::Intrinsic::SetValues,
};
using enum Intrinsic;

enum class ImplementationVisibility : uint8_t {
    Public = Engine::Visibility::Public,
    Private = Engine::Visibility::Private,
    PrivateRecursive = Engine::Visibility::PrivateRecursive,
};

enum class ErrorType : uint8_t {
    Error = Engine::ErrorType::Error,
    EvalError = Engine::ErrorType::EvalError,
    RangeError = Engine::ErrorType::RangeError,
    ReferenceError = Engine::ErrorType::ReferenceError,
    SyntaxError = Engine::ErrorType::SyntaxError,
    TypeError = Engine::ErrorType::TypeError,
    URIError = Engine::ErrorType::UriError,
    AggregateError = Engine::ErrorType::AggregateError,
    SuppressedError = Engine::ErrorType::SuppressedError,
};

enum class CollectionScope : uint8_t {
    Eden = Engine::Scope::Eden,
    Full = Engine::Scope::Full,
};

enum class HeapType : uint8_t {
    Small = Engine::HeapKind::Small,
    Large = Engine::HeapKind::Large,
};

enum class RootMarkReason : uint8_t {
    None = Engine::RootReason::None,
    StrongHandles = Engine::RootReason::StrongHandles,
};

enum class JSPromiseRejectionOperation : uint32_t {
    Reject = Engine::PromiseRejectionOperation::Reject,
    Handle = Engine::PromiseRejectionOperation::Handle,
};

enum class ScriptExecutionStatus : uint32_t {
    Running = Engine::ScriptExecutionStatus::Running,
    Suspended = Engine::ScriptExecutionStatus::Suspended,
    Stopped = Engine::ScriptExecutionStatus::Stopped,
};

enum class SourceProviderSourceType : uint8_t {
    Program = Engine::SourceType::Program,
    Module = Engine::SourceType::Module,
    WebAssembly = Engine::SourceType::WebAssembly,
    JSON = Engine::SourceType::Json,
    Synthetic = Engine::SourceType::Synthetic,
    BunTranspiledModule = Engine::SourceType::AnalyzedModule,
};

enum class ScriptFetchParametersType : uint8_t {
    None = Engine::ModuleType::None,
    JavaScript = Engine::ModuleType::JavaScript,
    WebAssembly = Engine::ModuleType::WebAssembly,
    JSON = Engine::ModuleType::Json,
    Text = Engine::ModuleType::Text,
    HostDefined = Engine::ModuleType::HostDefined,
    CSS = Engine::ModuleType::Css,
};

enum class InternalMicrotask : uint8_t;
enum class IterationKind : uint8_t;
enum class MessageLevel : uint8_t;
enum class MessageType : uint8_t;
enum class TemporalType : uint8_t;

enum class SubspaceAccess { OnMainThread,
    Concurrently };

enum class DestructionMode : uint8_t { DoesNotNeedDestruction,
    NeedsDestruction };
using enum DestructionMode;

enum class ProfilingReason : uint8_t {
    API = Engine::ProfilingReason::Api,
    Microtask = Engine::ProfilingReason::Microtask,
    Other = Engine::ProfilingReason::Other,
};

enum class SourceTaintedOrigin : uint8_t { Untainted };

class ECMAMode {
public:
    static constexpr ECMAMode strict() { return ECMAMode(true); }
    static constexpr ECMAMode sloppy() { return ECMAMode(false); }
    constexpr bool isStrict() const { return m_isStrict; }

private:
    explicit constexpr ECMAMode(bool isStrict)
        : m_isStrict(isStrict)
    {
    }

    bool m_isStrict;
};

inline constexpr PropertyOffset invalidOffset = -1;
inline constexpr PropertyOffset firstOutOfLineOffset = Engine::Layout::firstOutOfLineOffset;
constexpr bool isValidOffset(PropertyOffset offset) { return offset != invalidOffset; }
constexpr bool isInlineOffset(PropertyOffset offset) { return offset < firstOutOfLineOffset; }

#define MAX_ARRAY_INDEX static_cast<unsigned>(Engine::Layout::maxArrayIndex)

struct LineColumn {
    unsigned line { 0 };
    unsigned column { 0 };
};
ENGINE_CHECK_SIZE(LineColumn, sizeOfLineColumn);
ENGINE_CHECK_OFFSET(LineColumn, column, LineColumn_column);

ALWAYS_INLINE void ensureStillAliveHere(uint64_t value) { asm volatile("" : : "g"(value) : "memory"); }
ALWAYS_INLINE void ensureStillAliveHere(const void* pointer) { asm volatile("" : : "g"(pointer) : "memory"); }

VM& getVM(JSGlobalObject*);

} // namespace JSC
