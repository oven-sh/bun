/// JSType is a critical performance optimization in JavaScriptCore that enables O(1) type
/// identification for JavaScript values without virtual function calls or expensive RTTI.
///
/// THE FUNDAMENTAL ARCHITECTURE:
///
/// JSValue (64-bit on modern platforms):
/// ┌─────────────────────────────────────────────────────────────────┐
/// │ Either: Immediate value (int32, bool, null, undefined, double)   │
/// │    Or:  Pointer to JSCell + type bits                           │
/// └─────────────────────────────────────────────────────────────────┘
///
/// JSCell (base class for all heap objects):
/// ┌─────────────────────────────────────────────────────────────────┐
/// │ m_structureID │ m_indexingTypeAndMisc │ m_type │ m_flags │ ...   │
/// │               │                       │ (u8)   │         │       │
/// └─────────────────────────────────────────────────────────────────┘
///                                           ↑
///                                      JSType enum
///
/// PERFORMANCE CRITICAL DESIGN:
///
/// Instead of virtual function calls like:
///   if (cell->isString()) // virtual call overhead
///
/// JavaScriptCore uses direct memory access:
///   if (cell->type() == StringType) // single memory load + compare
///
/// This JSType enum provides the complete taxonomy of JavaScript runtime types,
/// enabling the engine to make blazing-fast type decisions that are essential
/// for JavaScript's dynamic nature.
///
/// TYPE HIERARCHY MAPPING:
///
/// JavaScript Primitives → JSType:
/// • string → String (heap-allocated) or immediate (small strings)
/// • number → immediate double/int32 or HeapBigInt
/// • boolean → immediate true/false
/// • symbol → Symbol
/// • bigint → HeapBigInt or BigInt32 (immediate)
/// • null/undefined → immediate values
///
/// JavaScript Objects → JSType:
/// • {} → Object, FinalObject
/// • [] → Array, DerivedArray
/// • function → JSFunction, InternalFunction
/// • new Int8Array() → Int8Array
/// • new Error() → ErrorInstance
/// • arguments → DirectArguments, ScopedArguments
///
/// Engine Internals → JSType:
/// • Structure → metadata for object layout optimization
/// • CodeBlock → compiled JavaScript bytecode
/// • Executable → function compilation units
///
/// FAST PATH OPTIMIZATIONS:
///
/// The JSType enables JavaScriptCore's legendary performance through:
///
/// 1. Inline Caching: "This property access was on a String last time,
///    check if it's still a String with one comparison"
///
/// 2. Speculative Compilation: "This function usually gets Arrays,
///    generate optimized code for Arrays and deoptimize if wrong"
///
/// 3. Polymorphic Inline Caches: "This call site sees Objects and Arrays,
///    generate a fast switch on JSType"
///
/// 4. Type Guards: "Assume this is a String, insert a type check,
///    and generate optimal string operations"
///
/// MEMORY LAYOUT OPTIMIZATION:
///
/// JSType is strategically placed in JSCell's header for cache efficiency.
/// A typical property access like obj.prop becomes:
///
/// 1. Load JSCell* from JSValue (1 instruction)
/// 2. Load JSType from JSCell header (1 instruction, same cache line)
/// 3. Compare JSType against expected type (1 instruction)
/// 4. Branch to optimized or generic path
///
/// This 3-instruction type check is what makes JavaScript competitive
/// with statically typed languages in hot code paths.
///
/// The enum values are carefully ordered to enable range checks:
/// • All typed arrays are consecutive (Int8Array..Float64Array)
/// • All function types are grouped together
/// • All array types are adjacent
///
/// This allows optimizations like:
///   if (type >= Int8Array && type <= Float64Array) // single range check
///   if (type >= JSFunction && type <= InternalFunction) // function check
pub const JSType = enum(u8) {
    Cell = 0,
    Structure = 1,
    String = 2,
    HeapBigInt = 3,
    Symbol = 4,
    GetterSetter = 5,
    CustomGetterSetter = 6,
    APIValueWrapper = 7,
    NativeExecutable = 8,
    ProgramExecutable = 9,
    ModuleProgramExecutable = 10,
    EvalExecutable = 11,
    FunctionExecutable = 12,
    UnlinkedFunctionExecutable = 13,
    UnlinkedProgramCodeBlock = 14,
    UnlinkedModuleProgramCodeBlock = 15,
    UnlinkedEvalCodeBlock = 16,
    UnlinkedFunctionCodeBlock = 17,
    CodeBlock = 18,
    JSImmutableButterfly = 19,
    JSSourceCode = 20,
    JSScriptFetcher = 21,
    JSScriptFetchParameters = 22,
    Object = 23,
    FinalObject = 24,
    JSCallee = 25,
    JSFunction = 26,
    InternalFunction = 27,
    NullSetterFunction = 28,
    BooleanObject = 29,
    NumberObject = 30,
    ErrorInstance = 31,
    GlobalProxy = 32,
    DirectArguments = 33,
    ScopedArguments = 34,
    ClonedArguments = 35,
    Array = 36,
    DerivedArray = 37,
    ArrayBuffer = 38,
    Int8Array = 39,
    Uint8Array = 40,
    Uint8ClampedArray = 41,
    Int16Array = 42,
    Uint16Array = 43,
    Int32Array = 44,
    Uint32Array = 45,
    Float16Array = 46,
    Float32Array = 47,
    Float64Array = 48,
    BigInt64Array = 49,
    BigUint64Array = 50,
    DataView = 51,
    GlobalObject = 52,
    GlobalLexicalEnvironment = 53,
    LexicalEnvironment = 54,
    ModuleEnvironment = 55,
    StrictEvalActivation = 56,
    WithScope = 57,
    AsyncDisposableStack = 58,
    DisposableStack = 59,
    ModuleNamespaceObject = 60,
    ShadowRealm = 61,
    RegExpObject = 62,
    JSDate = 63,
    ProxyObject = 64,
    Generator = 65,
    AsyncGenerator = 66,
    JSArrayIterator = 67,
    Iterator = 68,
    IteratorHelper = 69,
    MapIterator = 70,
    SetIterator = 71,
    StringIterator = 72,
    WrapForValidIterator = 73,
    RegExpStringIterator = 74,
    AsyncFromSyncIterator = 75,
    JSPromise = 76,
    Map = 77,
    Set = 78,
    WeakMap = 79,
    WeakSet = 80,
    WebAssemblyModule = 81,
    WebAssemblyInstance = 82,
    WebAssemblyGCObject = 83,
    StringObject = 84,
    DerivedStringObject = 85,
    InternalFieldTuple = 86,

    MaxJS = 0b11111111,
    Event = 0b11101111,
    DOMWrapper = 0b11101110,

    /// This means that we don't have Zig bindings for the type yet, but it
    /// implements .toJSON()
    JSAsJSONType = 0b11110000 | 1,
    _,

    pub const min_typed_array: JSType = .Int8Array;
    pub const max_typed_array: JSType = .DataView;

    pub fn canGet(this: JSType) bool {
        return switch (this) {
            .Array,
            .ArrayBuffer,
            .BigInt64Array,
            .BigUint64Array,
            .BooleanObject,
            .DOMWrapper,
            .DataView,
            .DerivedArray,
            .DerivedStringObject,
            .ErrorInstance,
            .Event,
            .FinalObject,
            .Float32Array,
            .Float16Array,
            .Float64Array,
            .GlobalObject,
            .Int16Array,
            .Int32Array,
            .Int8Array,
            .InternalFunction,
            .JSArrayIterator,
            .AsyncGenerator,
            .JSDate,
            .JSFunction,
            .Generator,
            .Map,
            .MapIterator,
            .JSPromise,
            .Set,
            .SetIterator,
            .IteratorHelper,
            .Iterator,
            .StringIterator,
            .WeakMap,
            .WeakSet,
            .ModuleNamespaceObject,
            .NumberObject,
            .Object,
            .ProxyObject,
            .RegExpObject,
            .ShadowRealm,
            .StringObject,
            .Uint16Array,
            .Uint32Array,
            .Uint8Array,
            .Uint8ClampedArray,
            .WebAssemblyModule,
            .WebAssemblyInstance,
            .WebAssemblyGCObject,
            => true,
            else => false,
        };
    }

    pub inline fn isObject(this: JSType) bool {
        // inline constexpr bool isObjectType(JSType type) { return type >= ObjectType; }
        return @intFromEnum(this) >= @intFromEnum(JSType.Object);
    }

    pub fn isFunction(this: JSType) bool {
        return switch (this) {
            .JSFunction, .FunctionExecutable, .InternalFunction => true,
            else => false,
        };
    }

    pub fn isTypedArrayOrArrayBuffer(this: JSType) bool {
        return switch (this) {
            .ArrayBuffer,
            .BigInt64Array,
            .BigUint64Array,
            .Float32Array,
            .Float16Array,
            .Float64Array,
            .Int16Array,
            .Int32Array,
            .Int8Array,
            .Uint16Array,
            .Uint32Array,
            .Uint8Array,
            .Uint8ClampedArray,
            => true,
            else => false,
        };
    }

    pub fn isArrayBufferLike(this: JSType) bool {
        return switch (this) {
            .DataView,
            .ArrayBuffer,
            .BigInt64Array,
            .BigUint64Array,
            .Float32Array,
            .Float16Array,
            .Float64Array,
            .Int16Array,
            .Int32Array,
            .Int8Array,
            .Uint16Array,
            .Uint32Array,
            .Uint8Array,
            .Uint8ClampedArray,
            => true,
            else => false,
        };
    }

    pub fn toC(this: JSType) C_API.JSTypedArrayType {
        return switch (this) {
            .Int8Array => .kJSTypedArrayTypeInt8Array,
            .Int16Array => .kJSTypedArrayTypeInt16Array,
            .Int32Array => .kJSTypedArrayTypeInt32Array,
            .Uint8Array => .kJSTypedArrayTypeUint8Array,
            .Uint8ClampedArray => .kJSTypedArrayTypeUint8ClampedArray,
            .Uint16Array => .kJSTypedArrayTypeUint16Array,
            .Uint32Array => .kJSTypedArrayTypeUint32Array,
            .Float32Array => .kJSTypedArrayTypeFloat32Array,
            .Float64Array => .kJSTypedArrayTypeFloat64Array,
            .ArrayBuffer => .kJSTypedArrayTypeArrayBuffer,
            .BigInt64Array => .kJSTypedArrayTypeBigInt64Array,
            .BigUint64Array => .kJSTypedArrayTypeBigUint64Array,
            // .DataView => .kJSTypedArrayTypeDataView,
            else => .kJSTypedArrayTypeNone,
        };
    }

    pub fn isHidden(this: JSType) bool {
        return switch (this) {
            .APIValueWrapper,
            .NativeExecutable,
            .ProgramExecutable,
            .ModuleProgramExecutable,
            .EvalExecutable,
            .FunctionExecutable,
            .UnlinkedFunctionExecutable,
            .UnlinkedProgramCodeBlock,
            .UnlinkedModuleProgramCodeBlock,
            .UnlinkedEvalCodeBlock,
            .UnlinkedFunctionCodeBlock,
            .CodeBlock,
            .JSImmutableButterfly,
            .JSSourceCode,
            .JSScriptFetcher,
            .JSScriptFetchParameters,
            => true,
            else => false,
        };
    }

    pub const LastMaybeFalsyCellPrimitive = JSType.HeapBigInt;
    pub const LastJSCObject = JSType.DerivedStringObject; // This is the last "JSC" Object type. After this, we have embedder's (e.g., WebCore) extended object types.

    pub inline fn isString(this: JSType) bool {
        return this == .String;
    }

    pub inline fn isStringObject(this: JSType) bool {
        return this == .StringObject;
    }

    pub inline fn isDerivedStringObject(this: JSType) bool {
        return this == .DerivedStringObject;
    }

    pub inline fn isStringObjectLike(this: JSType) bool {
        return this == .StringObject or this == .DerivedStringObject;
    }

    pub inline fn isStringLike(this: JSType) bool {
        return switch (this) {
            .String, .StringObject, .DerivedStringObject => true,
            else => false,
        };
    }

    pub inline fn isArray(this: JSType) bool {
        return switch (this) {
            .Array, .DerivedArray => true,
            else => false,
        };
    }

    pub inline fn isArrayLike(this: JSType) bool {
        return switch (this) {
            .Array,
            .DerivedArray,

            .ArrayBuffer,
            .BigInt64Array,
            .BigUint64Array,
            .Float32Array,
            .Float16Array,
            .Float64Array,
            .Int16Array,
            .Int32Array,
            .Int8Array,
            .Uint16Array,
            .Uint32Array,
            .Uint8Array,
            .Uint8ClampedArray,
            => true,
            else => false,
        };
    }

    pub inline fn isSet(this: JSType) bool {
        return switch (this) {
            .Set, .WeakSet => true,
            else => false,
        };
    }

    pub inline fn isMap(this: JSType) bool {
        return switch (this) {
            .Map, .WeakMap => true,
            else => false,
        };
    }

    pub inline fn isIndexable(this: JSType) bool {
        return switch (this) {
            .Object,
            .FinalObject,
            .Array,
            .DerivedArray,
            .ErrorInstance,
            .JSFunction,
            .InternalFunction,

            .ArrayBuffer,
            .BigInt64Array,
            .BigUint64Array,
            .Float32Array,
            .Float16Array,
            .Float64Array,
            .Int16Array,
            .Int32Array,
            .Int8Array,
            .Uint16Array,
            .Uint32Array,
            .Uint8Array,
            .Uint8ClampedArray,
            => true,
            else => false,
        };
    }

    pub inline fn isArguments(this: JSType) bool {
        return switch (this) {
            .DirectArguments, .ClonedArguments, .ScopedArguments => true,
            else => false,
        };
    }
};

const bun = @import("bun");
const C_API = bun.JSC.C;
