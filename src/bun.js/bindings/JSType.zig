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
    /// Base type for all JavaScript values that are heap-allocated.
    /// Every object, function, string, etc. in JavaScript inherits from JSCell.
    Cell = 0,

    /// Metadata object that describes the layout and properties of JavaScript objects.
    /// Critical for property access optimization and inline caching.
    Structure = 1,

    /// JavaScript string primitive.
    /// ```js
    /// "hello"
    /// 'world'
    /// `template ${string}`
    /// ```
    String = 2,

    /// Arbitrary precision integer type for JavaScript BigInt values.
    /// ```js
    /// 123n
    /// BigInt(456)
    /// 0x1ffffffffffffffffn
    /// ```
    HeapBigInt = 3,

    /// JavaScript Symbol primitive - unique identifiers.
    /// ```js
    /// Symbol()
    /// Symbol('description')
    /// Symbol.for('key')
    /// ```
    Symbol = 4,

    /// Accessor property descriptor containing getter and/or setter functions.
    /// ```js
    /// Object.defineProperty(obj, 'prop', {
    ///   get() { return this._value; },
    ///   set(v) { this._value = v; }
    /// })
    /// ```
    GetterSetter = 5,

    /// Custom native getter/setter implementation for built-in properties.
    /// ```js
    /// // Built-in properties like Array.prototype.length
    /// const arr = [1, 2, 3];
    /// arr.length; // uses CustomGetterSetter
    /// ```
    CustomGetterSetter = 6,

    /// Wrapper for native API values exposed to JavaScript.
    APIValueWrapper = 7,

    /// Compiled native code executable for built-in functions.
    /// ```js
    /// // Built-in functions like:
    /// parseInt("42")
    /// Array.from([1, 2, 3])
    /// ```
    NativeExecutable = 8,

    /// Compiled executable for top-level program code.
    ProgramExecutable = 9,

    /// Compiled executable for ES6 module code.
    ModuleProgramExecutable = 10,

    /// Compiled executable for eval() expressions.
    /// ```js
    /// eval('var x = 42; console.log(x);')
    /// ```
    EvalExecutable = 11,

    /// Compiled executable for function bodies.
    /// ```js
    /// function foo() { return 42; }
    /// const bar = () => 123
    /// ```
    FunctionExecutable = 12,

    UnlinkedFunctionExecutable = 13,
    UnlinkedProgramCodeBlock = 14,
    UnlinkedModuleProgramCodeBlock = 15,
    UnlinkedEvalCodeBlock = 16,
    UnlinkedFunctionCodeBlock = 17,

    /// Compiled bytecode block ready for execution.
    CodeBlock = 18,

    JSImmutableButterfly = 19,
    JSSourceCode = 20,
    JSScriptFetcher = 21,
    JSScriptFetchParameters = 22,

    /// Base JavaScript object type.
    /// ```js
    /// {}
    /// new Object()
    /// ```
    Object = 23,

    /// Optimized object type for object literals with fixed properties.
    /// ```js
    /// { a: 1, b: 2 }
    /// ```
    FinalObject = 24,

    JSCallee = 25,

    /// JavaScript function object created from JavaScript source code.
    /// ```js
    /// function foo() {}
    /// const bar = () => {}
    /// class MyClass {
    ///   method() {}
    /// }
    /// ```
    JSFunction = 26,

    /// Built-in function implemented in native code.
    /// ```js
    /// Array.prototype.push
    /// Object.keys
    /// parseInt
    /// console.log
    /// ```
    InternalFunction = 27,

    NullSetterFunction = 28,

    /// Boxed Boolean object.
    /// ```js
    /// new Boolean(true)
    /// new Boolean(false)
    /// ```
    BooleanObject = 29,

    /// Boxed Number object.
    /// ```js
    /// new Number(42)
    /// new Number(3.14)
    /// ```
    NumberObject = 30,

    /// JavaScript Error object and its subclasses.
    /// ```js
    /// new Error('message')
    /// new TypeError()
    /// throw new RangeError()
    /// ```
    ErrorInstance = 31,

    GlobalProxy = 32,

    /// Arguments object for function parameters.
    /// ```js
    /// function foo() {
    ///   console.log(arguments[0]);
    ///   console.log(arguments.length);
    /// }
    /// ```
    DirectArguments = 33,

    ScopedArguments = 34,
    ClonedArguments = 35,

    /// JavaScript Array object.
    /// ```js
    /// []
    /// [1, 2, 3]
    /// new Array(10)
    /// Array.from(iterable)
    /// ```
    Array = 36,

    /// Array subclass created through class extension.
    /// ```js
    /// class MyArray extends Array {}
    /// const arr = new MyArray();
    /// ```
    DerivedArray = 37,

    /// ArrayBuffer for binary data storage.
    /// ```js
    /// new ArrayBuffer(1024)
    /// ```
    ArrayBuffer = 38,

    /// Typed array for 8-bit signed integers.
    /// ```js
    /// new Int8Array(buffer)
    /// new Int8Array([1, -1, 127])
    /// ```
    Int8Array = 39,

    /// Typed array for 8-bit unsigned integers.
    /// ```js
    /// new Uint8Array(buffer)
    /// new Uint8Array([0, 255])
    /// ```
    Uint8Array = 40,

    /// Typed array for 8-bit unsigned integers with clamping.
    /// ```js
    /// new Uint8ClampedArray([0, 300]) // 300 becomes 255
    /// ```
    Uint8ClampedArray = 41,

    /// Typed array for 16-bit signed integers.
    /// ```js
    /// new Int16Array(buffer)
    /// ```
    Int16Array = 42,

    /// Typed array for 16-bit unsigned integers.
    /// ```js
    /// new Uint16Array(buffer)
    /// ```
    Uint16Array = 43,

    /// Typed array for 32-bit signed integers.
    /// ```js
    /// new Int32Array(buffer)
    /// ```
    Int32Array = 44,

    /// Typed array for 32-bit unsigned integers.
    /// ```js
    /// new Uint32Array(buffer)
    /// ```
    Uint32Array = 45,

    /// Typed array for 16-bit floating point numbers.
    /// ```js
    /// new Float16Array(buffer)
    /// ```
    Float16Array = 46,

    /// Typed array for 32-bit floating point numbers.
    /// ```js
    /// new Float32Array(buffer)
    /// ```
    Float32Array = 47,

    /// Typed array for 64-bit floating point numbers.
    /// ```js
    /// new Float64Array(buffer)
    /// ```
    Float64Array = 48,

    /// Typed array for 64-bit signed BigInt values.
    /// ```js
    /// new BigInt64Array([123n, -456n])
    /// ```
    BigInt64Array = 49,

    /// Typed array for 64-bit unsigned BigInt values.
    /// ```js
    /// new BigUint64Array([123n, 456n])
    /// ```
    BigUint64Array = 50,

    /// DataView for flexible binary data access.
    /// ```js
    /// new DataView(buffer)
    /// view.getInt32(0)
    /// view.setFloat64(8, 3.14)
    /// ```
    DataView = 51,

    /// Global object containing all global variables and functions.
    /// ```js
    /// globalThis
    /// window // in browsers
    /// global // in Node.js
    /// ```
    GlobalObject = 52,

    GlobalLexicalEnvironment = 53,
    LexicalEnvironment = 54,
    ModuleEnvironment = 55,
    StrictEvalActivation = 56,

    /// Scope object for with statements.
    /// ```js
    /// with (obj) {
    ///   prop; // looks up prop in obj first
    /// }
    /// ```
    WithScope = 57,

    AsyncDisposableStack = 58,
    DisposableStack = 59,

    /// Namespace object for ES6 modules.
    /// ```js
    /// import * as ns from 'module';
    /// ns.exportedFunction()
    /// ```
    ModuleNamespaceObject = 60,

    ShadowRealm = 61,

    /// Regular expression object.
    /// ```js
    /// /pattern/flags
    /// new RegExp('pattern', 'flags')
    /// /abc/gi
    /// ```
    RegExpObject = 62,

    /// JavaScript Date object for date/time operations.
    /// ```js
    /// new Date()
    /// new Date('2023-01-01')
    /// Date.now()
    /// ```
    JSDate = 63,

    /// Proxy object that intercepts operations on another object.
    /// ```js
    /// new Proxy(target, {
    ///   get(obj, prop) { return obj[prop]; }
    /// })
    /// ```
    ProxyObject = 64,

    /// Generator object created by generator functions.
    /// ```js
    /// function* gen() { yield 1; yield 2; }
    /// const g = gen();
    /// g.next()
    /// ```
    Generator = 65,

    /// Async generator object for asynchronous iteration.
    /// ```js
    /// async function* asyncGen() {
    ///   yield await promise;
    /// }
    /// ```
    AsyncGenerator = 66,

    /// Iterator for Array objects.
    /// ```js
    /// [1,2,3][Symbol.iterator]()
    /// for (const x of array) {}
    /// ```
    JSArrayIterator = 67,

    Iterator = 68,
    IteratorHelper = 69,

    /// Iterator for Map objects.
    /// ```js
    /// map.keys()
    /// map.values()
    /// map.entries()
    /// for (const [k,v] of map) {}
    /// ```
    MapIterator = 70,

    /// Iterator for Set objects.
    /// ```js
    /// set.values()
    /// for (const value of set) {}
    /// ```
    SetIterator = 71,

    /// Iterator for String objects.
    /// ```js
    /// 'hello'[Symbol.iterator]()
    /// for (const char of string) {}
    /// ```
    StringIterator = 72,

    WrapForValidIterator = 73,

    /// Iterator for RegExp string matching.
    /// ```js
    /// 'abc'.matchAll(/./g)
    /// for (const match of string.matchAll(regex)) {}
    /// ```
    RegExpStringIterator = 74,

    AsyncFromSyncIterator = 75,

    /// JavaScript Promise object for asynchronous operations.
    /// ```js
    /// new Promise((resolve, reject) => {})
    /// Promise.resolve(42)
    /// async function foo() { await promise; }
    /// ```
    JSPromise = 76,

    /// JavaScript Map object for key-value storage.
    /// ```js
    /// new Map()
    /// map.set(key, value)
    /// map.get(key)
    /// ```
    Map = 77,

    /// JavaScript Set object for unique value storage.
    /// ```js
    /// new Set()
    /// set.add(value)
    /// set.has(value)
    /// ```
    Set = 78,

    /// WeakMap for weak key-value references.
    /// ```js
    /// new WeakMap()
    /// weakMap.set(object, value)
    /// ```
    WeakMap = 79,

    /// WeakSet for weak value references.
    /// ```js
    /// new WeakSet()
    /// weakSet.add(object)
    /// ```
    WeakSet = 80,

    WebAssemblyModule = 81,
    WebAssemblyInstance = 82,
    WebAssemblyGCObject = 83,

    /// Boxed String object.
    /// ```js
    /// new String("hello")
    /// ```
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
