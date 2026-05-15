//! JSType is a critical performance optimization in JavaScriptCore that enables O(1) type
//! identification for JavaScript values without virtual function calls or expensive RTTI.
//!
//! THE FUNDAMENTAL ARCHITECTURE:
//!
//! JSValue (64-bit on modern platforms):
//! ┌─────────────────────────────────────────────────────────────────┐
//! │ Either: Immediate value (int32, bool, null, undefined, double)   │
//! │    Or:  Pointer to JSCell + type bits                           │
//! └─────────────────────────────────────────────────────────────────┘
//!
//! JSCell (base class for all heap objects):
//! ┌─────────────────────────────────────────────────────────────────┐
//! │ m_structureID │ m_indexingTypeAndMisc │ m_type │ m_flags │ ...   │
//! │               │                       │ (u8)   │         │       │
//! └─────────────────────────────────────────────────────────────────┘
//!                                           ↑
//!                                      JSType enum
//!
//! PERFORMANCE CRITICAL DESIGN:
//!
//! Instead of virtual function calls like:
//!   if (cell->isString()) // virtual call overhead
//!
//! JavaScriptCore uses direct memory access:
//!   if (cell->type() == StringType) // single memory load + compare
//!
//! This JSType enum provides the complete taxonomy of JavaScript runtime types,
//! enabling the engine to make blazing-fast type decisions that are essential
//! for JavaScript's dynamic nature.
//!
//! TYPE HIERARCHY MAPPING:
//!
//! JavaScript Primitives → JSType:
//! • string → String (heap-allocated) or immediate (small strings)
//! • number → immediate double/int32 or HeapBigInt
//! • boolean → immediate true/false
//! • symbol → Symbol
//! • bigint → HeapBigInt or BigInt32 (immediate)
//! • null/undefined → immediate values
//!
//! JavaScript Objects → JSType:
//! • {} → Object, FinalObject
//! • [] → Array, DerivedArray
//! • function → JSFunction, InternalFunction
//! • new Int8Array() → Int8Array
//! • new Error() → ErrorInstance
//! • arguments → DirectArguments, ScopedArguments
//!
//! Engine Internals → JSType:
//! • Structure → metadata for object layout optimization
//! • CodeBlock → compiled JavaScript bytecode
//! • Executable → function compilation units
//!
//! FAST PATH OPTIMIZATIONS:
//!
//! The JSType enables JavaScriptCore's legendary performance through:
//!
//! 1. Inline Caching: "This property access was on a String last time,
//!    check if it's still a String with one comparison"
//!
//! 2. Speculative Compilation: "This function usually gets Arrays,
//!    generate optimized code for Arrays and deoptimize if wrong"
//!
//! 3. Polymorphic Inline Caches: "This call site sees Objects and Arrays,
//!    generate a fast switch on JSType"
//!
//! 4. Type Guards: "Assume this is a String, insert a type check,
//!    and generate optimal string operations"
//!
//! MEMORY LAYOUT OPTIMIZATION:
//!
//! JSType is strategically placed in JSCell's header for cache efficiency.
//! A typical property access like obj.prop becomes:
//!
//! 1. Load JSCell* from JSValue (1 instruction)
//! 2. Load JSType from JSCell header (1 instruction, same cache line)
//! 3. Compare JSType against expected type (1 instruction)
//! 4. Branch to optimized or generic path
//!
//! This 3-instruction type check is what makes JavaScript competitive
//! with statically typed languages in hot code paths.
//!
//! The enum values are carefully ordered to enable range checks:
//! • All typed arrays are consecutive (Int8Array..Float64Array)
//! • All function types are grouped together
//! • All array types are adjacent
//!
//! This allows optimizations like:
//!   if (type >= Int8Array && type <= Float64Array) // single range check
//!   if (type >= JSFunction && type <= InternalFunction) // function check

use crate::array_buffer::TypedArrayType;

// PORT NOTE: Zig's `enum(u8) { ..., _ }` is non-exhaustive — any u8 value is a valid
// JSType (values are read directly from JSCell::m_type via FFI, including embedder-
// defined types). A plain `#[repr(u8)] enum` would be UB for unknown discriminants,
// so this is a transparent newtype with associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, core::marker::ConstParamTy)]
pub struct JSType(pub u8);

#[allow(non_upper_case_globals)]
impl JSType {
    /// Base type for all JavaScript values that are heap-allocated.
    /// Every object, function, string, etc. in JavaScript inherits from JSCell.
    pub const Cell: JSType = JSType(0);

    /// Metadata object that describes the layout and properties of JavaScript objects.
    /// Critical for property access optimization and inline caching.
    pub const Structure: JSType = JSType(1);

    /// JavaScript string primitive.
    /// ```js
    /// "hello"
    /// 'world'
    /// `template ${string}`
    /// ```
    pub const String: JSType = JSType(2);

    /// Arbitrary precision integer type for JavaScript BigInt values.
    /// ```js
    /// 123n
    /// BigInt(456)
    /// 0x1ffffffffffffffffn
    /// ```
    pub const HeapBigInt: JSType = JSType(3);

    /// Heap-allocated double values (new in recent WebKit).
    pub const HeapDouble: JSType = JSType(4);

    /// Heap-allocated int32 values (new in recent WebKit).
    pub const HeapInt32: JSType = JSType(5);

    /// JavaScript Symbol primitive - unique identifiers.
    /// ```js
    /// Symbol()
    /// Symbol('description')
    /// Symbol.for('key')
    /// ```
    pub const Symbol: JSType = JSType(6);

    /// Accessor property descriptor containing getter and/or setter functions.
    /// ```js
    /// Object.defineProperty(obj, 'prop', {
    ///   get() { return this._value; },
    ///   set(v) { this._value = v; }
    /// })
    /// ```
    pub const GetterSetter: JSType = JSType(7);

    /// Custom native getter/setter implementation for built-in properties.
    /// ```js
    /// // Built-in properties like Array.prototype.length
    /// const arr = [1, 2, 3];
    /// arr.length; // uses CustomGetterSetter
    /// ```
    pub const CustomGetterSetter: JSType = JSType(8);

    /// Wrapper for native API values exposed to JavaScript.
    pub const APIValueWrapper: JSType = JSType(9);

    /// Compiled native code executable for built-in functions.
    /// ```js
    /// // Built-in functions like:
    /// parseInt("42")
    /// Array.from([1, 2, 3])
    /// ```
    pub const NativeExecutable: JSType = JSType(10);

    /// Compiled executable for top-level program code.
    pub const ProgramExecutable: JSType = JSType(11);

    /// Compiled executable for ES6 module code.
    pub const ModuleProgramExecutable: JSType = JSType(12);

    /// Compiled executable for eval() expressions.
    /// ```js
    /// eval('var x = 42; console.log(x);')
    /// ```
    pub const EvalExecutable: JSType = JSType(13);

    /// Compiled executable for function bodies.
    /// ```js
    /// function foo() { return 42; }
    /// const bar = () => 123
    /// ```
    pub const FunctionExecutable: JSType = JSType(14);

    pub const UnlinkedFunctionExecutable: JSType = JSType(15);
    pub const UnlinkedProgramCodeBlock: JSType = JSType(16);
    pub const UnlinkedModuleProgramCodeBlock: JSType = JSType(17);
    pub const UnlinkedEvalCodeBlock: JSType = JSType(18);
    pub const UnlinkedFunctionCodeBlock: JSType = JSType(19);

    /// Compiled bytecode block ready for execution.
    pub const CodeBlock: JSType = JSType(20);

    pub const JSCellButterfly: JSType = JSType(21);
    pub const JSSourceCode: JSType = JSType(22);

    /// Slim promise reaction (no rejection handler / context payload).
    /// Internal object used in the promise resolution mechanism.
    pub const SlimPromiseReaction: JSType = JSType(23);

    /// Full promise reaction (carries onFulfilled/onRejected and async context).
    /// Internal object used in the promise resolution mechanism.
    pub const FullPromiseReaction: JSType = JSType(24);

    /// Context object for Promise.all() operations.
    /// Internal object used to track the state of Promise.all() resolution.
    /// Note: Moved before ObjectType in recent WebKit.
    pub const PromiseAllContext: JSType = JSType(25);

    /// Global context for Promise.all() (new in recent WebKit).
    pub const PromiseAllGlobalContext: JSType = JSType(26);

    /// Microtask dispatcher for promise/microtask queue management.
    pub const JSMicrotaskDispatcher: JSType = JSType(27);

    /// Module loader registry entry (new C++ module loader).
    pub const ModuleRegistryEntry: JSType = JSType(28);

    /// Module loading context (new C++ module loader).
    pub const ModuleLoadingContext: JSType = JSType(29);

    /// Module loader payload (new C++ module loader).
    pub const ModuleLoaderPayload: JSType = JSType(30);

    /// Module graph loading state (new C++ module loader).
    pub const ModuleGraphLoadingState: JSType = JSType(31);

    /// JSModuleLoader cell type (new C++ module loader).
    pub const JSModuleLoader: JSType = JSType(32);

    /// Base JavaScript object type.
    /// ```js
    /// {}
    /// new Object()
    /// ```
    pub const Object: JSType = JSType(33);

    /// Optimized object type for object literals with fixed properties.
    /// ```js
    /// { a: 1, b: 2 }
    /// ```
    pub const FinalObject: JSType = JSType(34);

    pub const JSCallee: JSType = JSType(35);

    /// JavaScript function object created from JavaScript source code.
    /// ```js
    /// function foo() {}
    /// const bar = () => {}
    /// class MyClass {
    ///   method() {}
    /// }
    /// ```
    pub const JSFunction: JSType = JSType(36);

    /// Built-in function implemented in native code.
    /// ```js
    /// Array.prototype.push
    /// Object.keys
    /// parseInt
    /// console.log
    /// ```
    pub const InternalFunction: JSType = JSType(37);

    pub const NullSetterFunction: JSType = JSType(38);

    /// Boxed Boolean object.
    /// ```js
    /// new Boolean(true)
    /// new Boolean(false)
    /// ```
    pub const BooleanObject: JSType = JSType(39);

    /// Boxed Number object.
    /// ```js
    /// new Number(42)
    /// new Number(3.14)
    /// ```
    pub const NumberObject: JSType = JSType(40);

    /// JavaScript Error object and its subclasses.
    /// ```js
    /// new Error('message')
    /// new TypeError()
    /// throw new RangeError()
    /// ```
    pub const ErrorInstance: JSType = JSType(41);

    pub const GlobalProxy: JSType = JSType(42);

    /// Arguments object for function parameters.
    /// ```js
    /// function foo() {
    ///   console.log(arguments[0]);
    ///   console.log(arguments.length);
    /// }
    /// ```
    pub const DirectArguments: JSType = JSType(43);

    pub const ScopedArguments: JSType = JSType(44);
    pub const ClonedArguments: JSType = JSType(45);

    /// JavaScript Array object.
    /// ```js
    /// []
    /// [1, 2, 3]
    /// new Array(10)
    /// Array.from(iterable)
    /// ```
    pub const Array: JSType = JSType(46);

    /// Array subclass created through class extension.
    /// ```js
    /// class MyArray extends Array {}
    /// const arr = new MyArray();
    /// ```
    pub const DerivedArray: JSType = JSType(47);

    /// ArrayBuffer for binary data storage.
    /// ```js
    /// new ArrayBuffer(1024)
    /// ```
    pub const ArrayBuffer: JSType = JSType(48);

    /// Typed array for 8-bit signed integers.
    /// ```js
    /// new Int8Array(buffer)
    /// new Int8Array([1, -1, 127])
    /// ```
    pub const Int8Array: JSType = JSType(49);

    /// Typed array for 8-bit unsigned integers.
    /// ```js
    /// new Uint8Array(buffer)
    /// new Uint8Array([0, 255])
    /// ```
    pub const Uint8Array: JSType = JSType(50);

    /// Typed array for 8-bit unsigned integers with clamping.
    /// ```js
    /// new Uint8ClampedArray([0, 300]) // 300 becomes 255
    /// ```
    pub const Uint8ClampedArray: JSType = JSType(51);

    /// Typed array for 16-bit signed integers.
    /// ```js
    /// new Int16Array(buffer)
    /// ```
    pub const Int16Array: JSType = JSType(52);

    /// Typed array for 16-bit unsigned integers.
    /// ```js
    /// new Uint16Array(buffer)
    /// ```
    pub const Uint16Array: JSType = JSType(53);

    /// Typed array for 32-bit signed integers.
    /// ```js
    /// new Int32Array(buffer)
    /// ```
    pub const Int32Array: JSType = JSType(54);

    /// Typed array for 32-bit unsigned integers.
    /// ```js
    /// new Uint32Array(buffer)
    /// ```
    pub const Uint32Array: JSType = JSType(55);

    /// Typed array for 16-bit floating point numbers.
    /// ```js
    /// new Float16Array(buffer)
    /// ```
    pub const Float16Array: JSType = JSType(56);

    /// Typed array for 32-bit floating point numbers.
    /// ```js
    /// new Float32Array(buffer)
    /// ```
    pub const Float32Array: JSType = JSType(57);

    /// Typed array for 64-bit floating point numbers.
    /// ```js
    /// new Float64Array(buffer)
    /// ```
    pub const Float64Array: JSType = JSType(58);

    /// Typed array for 64-bit signed BigInt values.
    /// ```js
    /// new BigInt64Array([123n, -456n])
    /// ```
    pub const BigInt64Array: JSType = JSType(59);

    /// Typed array for 64-bit unsigned BigInt values.
    /// ```js
    /// new BigUint64Array([123n, 456n])
    /// ```
    pub const BigUint64Array: JSType = JSType(60);

    /// DataView for flexible binary data access.
    /// ```js
    /// new DataView(buffer)
    /// view.getInt32(0)
    /// view.setFloat64(8, 3.14)
    /// ```
    pub const DataView: JSType = JSType(61);

    /// Global object containing all global variables and functions.
    /// ```js
    /// globalThis
    /// window // in browsers
    /// global // in Node.js
    /// ```
    pub const GlobalObject: JSType = JSType(62);

    pub const GlobalLexicalEnvironment: JSType = JSType(63);
    pub const LexicalEnvironment: JSType = JSType(64);
    pub const ModuleEnvironment: JSType = JSType(65);
    pub const StrictEvalActivation: JSType = JSType(66);

    /// Scope object for with statements.
    /// ```js
    /// with (obj) {
    ///   prop; // looks up prop in obj first
    /// }
    /// ```
    pub const WithScope: JSType = JSType(67);

    pub const AsyncDisposableStack: JSType = JSType(68);
    pub const DisposableStack: JSType = JSType(69);

    /// Namespace object for ES6 modules.
    /// ```js
    /// import * as ns from 'module';
    /// ns.exportedFunction()
    /// ```
    pub const ModuleNamespaceObject: JSType = JSType(70);

    pub const ShadowRealm: JSType = JSType(71);

    /// Regular expression object.
    /// ```js
    /// /pattern/flags
    /// new RegExp('pattern', 'flags')
    /// /abc/gi
    /// ```
    pub const RegExpObject: JSType = JSType(72);

    /// JavaScript Date object for date/time operations.
    /// ```js
    /// new Date()
    /// new Date('2023-01-01')
    /// Date.now()
    /// ```
    pub const JSDate: JSType = JSType(73);

    /// Proxy object that intercepts operations on another object.
    /// ```js
    /// new Proxy(target, {
    ///   get(obj, prop) { return obj[prop]; }
    /// })
    /// ```
    pub const ProxyObject: JSType = JSType(74);

    /// Generator object created by generator functions.
    /// ```js
    /// function* gen() { yield 1; yield 2; }
    /// const g = gen();
    /// g.next()
    /// ```
    pub const Generator: JSType = JSType(75);

    /// Async generator object for asynchronous iteration.
    /// ```js
    /// async function* asyncGen() {
    ///   yield await promise;
    /// }
    /// ```
    pub const AsyncGenerator: JSType = JSType(76);

    /// Iterator for Array objects.
    /// ```js
    /// [1,2,3][Symbol.iterator]()
    /// for (const x of array) {}
    /// ```
    pub const JSArrayIterator: JSType = JSType(77);

    pub const Iterator: JSType = JSType(78);
    pub const IteratorHelper: JSType = JSType(79);

    /// Iterator for Map objects.
    /// ```js
    /// map.keys()
    /// map.values()
    /// map.entries()
    /// for (const [k,v] of map) {}
    /// ```
    pub const MapIterator: JSType = JSType(80);

    /// Iterator for Set objects.
    /// ```js
    /// set.values()
    /// for (const value of set) {}
    /// ```
    pub const SetIterator: JSType = JSType(81);

    /// Iterator for String objects.
    /// ```js
    /// 'hello'[Symbol.iterator]()
    /// for (const char of string) {}
    /// ```
    pub const StringIterator: JSType = JSType(82);

    pub const WrapForValidIterator: JSType = JSType(83);

    /// Iterator for RegExp string matching.
    /// ```js
    /// 'abc'.matchAll(/./g)
    /// for (const match of string.matchAll(regex)) {}
    /// ```
    pub const RegExpStringIterator: JSType = JSType(84);

    pub const AsyncFromSyncIterator: JSType = JSType(85);

    /// JavaScript Promise object for asynchronous operations.
    /// ```js
    /// new Promise((resolve, reject) => {})
    /// Promise.resolve(42)
    /// async function foo() { await promise; }
    /// ```
    pub const JSPromise: JSType = JSType(86);

    /// JavaScript Map object for key-value storage.
    /// ```js
    /// new Map()
    /// map.set(key, value)
    /// map.get(key)
    /// ```
    pub const Map: JSType = JSType(87);

    /// JavaScript Set object for unique value storage.
    /// ```js
    /// new Set()
    /// set.add(value)
    /// set.has(value)
    /// ```
    pub const Set: JSType = JSType(88);

    /// WeakMap for weak key-value references.
    /// ```js
    /// new WeakMap()
    /// weakMap.set(object, value)
    /// ```
    pub const WeakMap: JSType = JSType(89);

    /// WeakSet for weak value references.
    /// ```js
    /// new WeakSet()
    /// weakSet.add(object)
    /// ```
    pub const WeakSet: JSType = JSType(90);

    pub const WebAssemblyModule: JSType = JSType(91);
    pub const WebAssemblyInstance: JSType = JSType(92);
    pub const WebAssemblyGCObject: JSType = JSType(93);

    /// Boxed String object.
    /// ```js
    /// new String("hello")
    /// ```
    pub const StringObject: JSType = JSType(94);

    pub const DerivedStringObject: JSType = JSType(95);
    pub const InternalFieldTuple: JSType = JSType(96);

    pub const MaxJS: JSType = JSType(0b11111111);
    pub const Event: JSType = JSType(0b11101111);
    pub const DOMWrapper: JSType = JSType(0b11101110);
    pub const EmbedderArrayLike: JSType = JSType(0b11101101);

    /// This means that we don't have Zig bindings for the type yet, but it
    /// implements .toJSON()
    pub const JSAsJSONType: JSType = JSType(0b11110000 | 1);
}

impl JSType {
    pub const MIN_TYPED_ARRAY: JSType = JSType::Int8Array;
    pub const MAX_TYPED_ARRAY: JSType = JSType::DataView;

    /// Port of Zig `@tagName(arrayBuffer.typed_array_type)` — `JSType` is a
    /// newtype-const (not a Rust `enum`), so there is no derived stringifier.
    /// Covers every `is_typed_array_or_array_buffer()` variant + `DataView`.
    /// The `_ => "TypedArray"` arm is unreachable for any real
    /// `ArrayBuffer.typed_array_type` (always one of the 14).
    pub fn typed_array_name(self) -> &'static [u8] {
        match self {
            JSType::ArrayBuffer => b"ArrayBuffer",
            JSType::Int8Array => b"Int8Array",
            JSType::Uint8Array => b"Uint8Array",
            JSType::Uint8ClampedArray => b"Uint8ClampedArray",
            JSType::Int16Array => b"Int16Array",
            JSType::Uint16Array => b"Uint16Array",
            JSType::Int32Array => b"Int32Array",
            JSType::Uint32Array => b"Uint32Array",
            JSType::Float16Array => b"Float16Array",
            JSType::Float32Array => b"Float32Array",
            JSType::Float64Array => b"Float64Array",
            JSType::BigInt64Array => b"BigInt64Array",
            JSType::BigUint64Array => b"BigUint64Array",
            JSType::DataView => b"DataView",
            _ => b"TypedArray",
        }
    }

    pub fn can_get(self) -> bool {
        matches!(
            self,
            JSType::Array
                | JSType::ArrayBuffer
                | JSType::BigInt64Array
                | JSType::BigUint64Array
                | JSType::BooleanObject
                | JSType::DOMWrapper
                | JSType::DataView
                | JSType::DerivedArray
                | JSType::DerivedStringObject
                | JSType::ErrorInstance
                | JSType::Event
                | JSType::FinalObject
                | JSType::Float32Array
                | JSType::Float16Array
                | JSType::Float64Array
                | JSType::GlobalObject
                | JSType::Int16Array
                | JSType::Int32Array
                | JSType::Int8Array
                | JSType::InternalFunction
                | JSType::JSArrayIterator
                | JSType::AsyncGenerator
                | JSType::JSDate
                | JSType::JSFunction
                | JSType::Generator
                | JSType::Map
                | JSType::MapIterator
                | JSType::JSPromise
                | JSType::Set
                | JSType::SetIterator
                | JSType::IteratorHelper
                | JSType::Iterator
                | JSType::StringIterator
                | JSType::WeakMap
                | JSType::WeakSet
                | JSType::ModuleNamespaceObject
                | JSType::NumberObject
                | JSType::Object
                | JSType::ProxyObject
                | JSType::RegExpObject
                | JSType::ShadowRealm
                | JSType::StringObject
                | JSType::Uint16Array
                | JSType::Uint32Array
                | JSType::Uint8Array
                | JSType::Uint8ClampedArray
                | JSType::WebAssemblyModule
                | JSType::WebAssemblyInstance
                | JSType::WebAssemblyGCObject
        )
    }

    #[inline]
    pub fn is_object(self) -> bool {
        // inline constexpr bool isObjectType(JSType type) { return type >= ObjectType; }
        self.0 >= JSType::Object.0
    }

    pub fn is_function(self) -> bool {
        matches!(
            self,
            JSType::JSFunction | JSType::FunctionExecutable | JSType::InternalFunction
        )
    }

    pub fn is_typed_array_or_array_buffer(self) -> bool {
        matches!(
            self,
            JSType::ArrayBuffer
                | JSType::BigInt64Array
                | JSType::BigUint64Array
                | JSType::Float32Array
                | JSType::Float16Array
                | JSType::Float64Array
                | JSType::Int16Array
                | JSType::Int32Array
                | JSType::Int8Array
                | JSType::Uint16Array
                | JSType::Uint32Array
                | JSType::Uint8Array
                | JSType::Uint8ClampedArray
        )
    }

    pub fn is_array_buffer_like(self) -> bool {
        matches!(
            self,
            JSType::DataView
                | JSType::ArrayBuffer
                | JSType::BigInt64Array
                | JSType::BigUint64Array
                | JSType::Float32Array
                | JSType::Float16Array
                | JSType::Float64Array
                | JSType::Int16Array
                | JSType::Int32Array
                | JSType::Int8Array
                | JSType::Uint16Array
                | JSType::Uint32Array
                | JSType::Uint8Array
                | JSType::Uint8ClampedArray
        )
    }

    pub fn to_typed_array_type(self) -> TypedArrayType {
        match self {
            JSType::Int8Array => TypedArrayType::TypeInt8,
            JSType::Int16Array => TypedArrayType::TypeInt16,
            JSType::Int32Array => TypedArrayType::TypeInt32,
            JSType::Uint8Array => TypedArrayType::TypeUint8,
            JSType::Uint8ClampedArray => TypedArrayType::TypeUint8Clamped,
            JSType::Uint16Array => TypedArrayType::TypeUint16,
            JSType::Uint32Array => TypedArrayType::TypeUint32,
            JSType::Float16Array => TypedArrayType::TypeFloat16,
            JSType::Float32Array => TypedArrayType::TypeFloat32,
            JSType::Float64Array => TypedArrayType::TypeFloat64,
            JSType::BigInt64Array => TypedArrayType::TypeBigInt64,
            JSType::BigUint64Array => TypedArrayType::TypeBigUint64,
            JSType::DataView => TypedArrayType::TypeDataView,
            _ => TypedArrayType::TypeNone,
        }
    }

    pub fn is_hidden(self) -> bool {
        matches!(
            self,
            JSType::APIValueWrapper
                | JSType::NativeExecutable
                | JSType::ProgramExecutable
                | JSType::ModuleProgramExecutable
                | JSType::EvalExecutable
                | JSType::FunctionExecutable
                | JSType::UnlinkedFunctionExecutable
                | JSType::UnlinkedProgramCodeBlock
                | JSType::UnlinkedModuleProgramCodeBlock
                | JSType::UnlinkedEvalCodeBlock
                | JSType::UnlinkedFunctionCodeBlock
                | JSType::CodeBlock
                | JSType::JSCellButterfly
                | JSType::JSSourceCode
                | JSType::SlimPromiseReaction
                | JSType::FullPromiseReaction
                | JSType::PromiseAllContext
                | JSType::PromiseAllGlobalContext
        )
    }

    pub const LAST_MAYBE_FALSY_CELL_PRIMITIVE: JSType = JSType::HeapBigInt;
    /// This is the last "JSC" Object type. After this, we have embedder's (e.g., WebCore) extended object types.
    pub const LAST_JSC_OBJECT: JSType = JSType::InternalFieldTuple;

    #[inline]
    pub fn is_string(self) -> bool {
        self == JSType::String
    }

    #[inline]
    pub fn is_string_object(self) -> bool {
        self == JSType::StringObject
    }

    #[inline]
    pub fn is_derived_string_object(self) -> bool {
        self == JSType::DerivedStringObject
    }

    #[inline]
    pub fn is_string_object_like(self) -> bool {
        self == JSType::StringObject || self == JSType::DerivedStringObject
    }

    #[inline]
    pub fn is_string_like(self) -> bool {
        matches!(
            self,
            JSType::String | JSType::StringObject | JSType::DerivedStringObject
        )
    }

    #[inline]
    pub fn is_array(self) -> bool {
        matches!(self, JSType::Array | JSType::DerivedArray)
    }

    #[inline]
    pub fn is_array_like(self) -> bool {
        matches!(
            self,
            JSType::Array
                | JSType::DerivedArray
                | JSType::ArrayBuffer
                | JSType::BigInt64Array
                | JSType::BigUint64Array
                | JSType::Float32Array
                | JSType::Float16Array
                | JSType::Float64Array
                | JSType::Int16Array
                | JSType::Int32Array
                | JSType::Int8Array
                | JSType::Uint16Array
                | JSType::Uint32Array
                | JSType::Uint8Array
                | JSType::Uint8ClampedArray
        )
    }

    #[inline]
    pub fn is_set(self) -> bool {
        matches!(self, JSType::Set | JSType::WeakSet)
    }

    #[inline]
    pub fn is_map(self) -> bool {
        matches!(self, JSType::Map | JSType::WeakMap)
    }

    #[inline]
    pub fn is_indexable(self) -> bool {
        matches!(
            self,
            JSType::Object
                | JSType::FinalObject
                | JSType::Array
                | JSType::DerivedArray
                | JSType::ErrorInstance
                | JSType::JSFunction
                | JSType::InternalFunction
                | JSType::ArrayBuffer
                | JSType::BigInt64Array
                | JSType::BigUint64Array
                | JSType::Float32Array
                | JSType::Float16Array
                | JSType::Float64Array
                | JSType::Int16Array
                | JSType::Int32Array
                | JSType::Int8Array
                | JSType::Uint16Array
                | JSType::Uint32Array
                | JSType::Uint8Array
                | JSType::Uint8ClampedArray
        )
    }

    #[inline]
    pub fn is_arguments(self) -> bool {
        matches!(
            self,
            JSType::DirectArguments | JSType::ClonedArguments | JSType::ScopedArguments
        )
    }
}

// ported from: src/jsc/JSType.zig
