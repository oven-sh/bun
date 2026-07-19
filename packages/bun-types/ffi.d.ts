/**
 * `bun:ffi` calls C functions from JavaScript without requiring you to write
 * bindings.
 *
 * ```js
 * import {dlopen, CString, ptr} from 'bun:ffi';
 *
 * const lib = dlopen('libsqlite3', {
 * });
 * ```
 *
 * Bun uses [tinycc](https://github.com/TinyCC/tinycc) to just-in-time compile
 * C wrappers that convert JavaScript types to C types and back.
 *
 * @category FFI
 */
declare module "bun:ffi" {
  enum FFIType {
    char = 0,
    /**
     * 8-bit signed integer
     *
     * Must be a value between -128 and 127
     *
     * When passing to an FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * signed char
     * char // on x64 & aarch64 macOS
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    int8_t = 1,
    /**
     * 8-bit signed integer
     *
     * Must be a value between -128 and 127
     *
     * When passing to an FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * signed char
     * char // on x64 & aarch64 macOS
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    i8 = 1,

    /**
     * 8-bit unsigned integer
     *
     * Must be a value between 0 and 255
     *
     * When passing to an FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * unsigned char
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    uint8_t = 2,
    /**
     * 8-bit unsigned integer
     *
     * Must be a value between 0 and 255
     *
     * When passing to an FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * unsigned char
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    u8 = 2,

    /**
     * 16-bit signed integer
     *
     * Must be a value between -32768 and 32767
     *
     * When passing to an FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * int16_t
     * short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    int16_t = 3,
    /**
     * 16-bit signed integer
     *
     * Must be a value between -32768 and 32767
     *
     * When passing to an FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * int16_t
     * short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    i16 = 3,

    /**
     * 16-bit unsigned integer
     *
     * Must be a value between 0 and 65535, inclusive.
     *
     * When passing to an FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * uint16_t
     * unsigned short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    uint16_t = 4,
    /**
     * 16-bit unsigned integer
     *
     * Must be a value between 0 and 65535, inclusive.
     *
     * When passing to an FFI function (C ABI), type coercion is not performed.
     *
     * In C:
     * ```c
     * uint16_t
     * unsigned short // on arm64 & x64
     * ```
     *
     * In JavaScript:
     * ```js
     * var num = 0;
     * ```
     */
    u16 = 4,

    /**
     * 32-bit signed integer
     */
    int32_t = 5,

    /**
     * 32-bit signed integer
     *
     * Alias of {@link FFIType.int32_t}
     */
    i32 = 5,
    /**
     * 32-bit signed integer
     *
     * The same as `int` in C
     *
     * ```c
     * int
     * ```
     */
    int = 5,

    /**
     * 32-bit unsigned integer
     *
     * The same as `unsigned int` in C (on x64 & arm64)
     *
     * C:
     * ```c
     * unsigned int
     * ```
     * JavaScript:
     * ```js
     * ptr(new Uint32Array(1))
     * ```
     */
    uint32_t = 6,
    /**
     * 32-bit unsigned integer
     *
     * Alias of {@link FFIType.uint32_t}
     */
    u32 = 6,

    /**
     * 64-bit signed integer
     */
    int64_t = 7,
    /**
     * 64-bit signed integer
     *
     * Alias of {@link FFIType.int64_t}
     */
    i64 = 7,

    /**
     * 64-bit unsigned integer
     */
    uint64_t = 8,
    /**
     * 64-bit unsigned integer
     */
    u64 = 8,

    /**
     * IEEE-754 double precision float
     */
    double = 9,

    /**
     * Alias of {@link FFIType.double}
     */
    f64 = 9,

    /**
     * IEEE-754 single precision float
     */
    float = 10,

    /**
     * Alias of {@link FFIType.float}
     */
    f32 = 10,

    /**
     * Boolean value
     *
     * Must be `true` or `false`. `0` and `1` type coercion is not supported.
     *
     * In C, this corresponds to:
     * ```c
     * bool
     * _Bool
     * ```
     */
    bool = 11,

    /**
     * Pointer value
     *
     * See the `ptr()` function for getting a pointer from a `TypedArray`
     *
     * In C:
     * ```c
     * void*
     * ```
     *
     * In JavaScript:
     * ```js
     * ptr(new Uint8Array(1))
     * ```
     */
    ptr = 12,
    /**
     * Pointer value
     *
     * Alias of {@link FFIType.ptr}
     */
    pointer = 12,

    /**
     * void value
     *
     * void arguments are not supported
     *
     * void return type is the default return type
     *
     * In C:
     * ```c
     * void
     * ```
     */
    void = 13,

    /**
     * When used as a `returns`, the value becomes a {@link CString}.
     *
     * When used in `args`, it is equivalent to {@link FFIType.pointer}
     */
    cstring = 14,

    /**
     * Attempts to coerce a `BigInt` into a `number` when it fits. This improves
     * performance, but the JavaScript value may be either a `number` or a
     * `BigInt`, depending on the value.
     *
     * In C, this always becomes `int64_t`
     */
    i64_fast = 15,

    /**
     * Attempts to coerce a `BigInt` into a `number` when it fits. This improves
     * performance, but the JavaScript value may be either a `number` or a
     * `BigInt`, depending on the value.
     *
     * In C, this always becomes `uint64_t`
     */
    u64_fast = 16,
    function = 17,

    napi_env = 18,
    napi_value = 19,
    buffer = 20,
  }

  type Pointer = number & { __pointer__: null };

  // Only the canonical enum members are listed below. `FFIType` declares
  // several alias members (e.g. `i8` for `int8_t`, `pointer` for `ptr`) that
  // share the same numeric value. Including both an enum member and its alias
  // as computed property keys makes `tsgo` report duplicate identifiers, and
  // the resulting lookup type is identical regardless of which alias is used
  // since both resolve to the same numeric key.
  interface FFITypeToArgsType {
    [FFIType.char]: number;
    [FFIType.int8_t]: number;
    [FFIType.uint8_t]: number;
    [FFIType.int16_t]: number;
    [FFIType.uint16_t]: number;
    [FFIType.int32_t]: number;
    [FFIType.uint32_t]: number;
    [FFIType.int64_t]: number | bigint;
    [FFIType.uint64_t]: number | bigint;
    [FFIType.double]: number;
    [FFIType.float]: number;
    [FFIType.bool]: boolean;
    [FFIType.ptr]: NodeJS.TypedArray | DataView | ArrayBuffer | Pointer | CString | null;
    [FFIType.void]: undefined;
    [FFIType.cstring]: NodeJS.TypedArray | DataView | ArrayBuffer | Pointer | CString | null;
    [FFIType.i64_fast]: number | bigint;
    [FFIType.u64_fast]: number | bigint;
    [FFIType.function]: Pointer | JSCallback; // cannot be null
    [FFIType.napi_env]: unknown;
    [FFIType.napi_value]: unknown;
    [FFIType.buffer]: NodeJS.TypedArray | DataView;
  }
  interface FFITypeToReturnsType {
    [FFIType.char]: number;
    [FFIType.int8_t]: number;
    [FFIType.uint8_t]: number;
    [FFIType.int16_t]: number;
    [FFIType.uint16_t]: number;
    [FFIType.int32_t]: number;
    [FFIType.uint32_t]: number;
    [FFIType.int64_t]: bigint;
    [FFIType.uint64_t]: bigint;
    [FFIType.double]: number;
    [FFIType.float]: number;
    [FFIType.bool]: boolean;
    [FFIType.ptr]: Pointer | null;
    [FFIType.void]: undefined;
    [FFIType.cstring]: CString;
    [FFIType.i64_fast]: number | bigint;
    [FFIType.u64_fast]: number | bigint;
    [FFIType.function]: Pointer | null;
    [FFIType.napi_env]: unknown;
    [FFIType.napi_value]: unknown;
    [FFIType.buffer]: NodeJS.TypedArray | DataView;
  }
  /**
   * Values a {@link JSCallback} receives when invoked from native code.
   *
   * Unlike {@link FFITypeToReturnsType}, a `cstring` argument arrives as a raw
   * {@link Pointer} (or `null`), not a {@link CString}. Wrap it yourself with
   * `new CString(ptr)` if you need the string contents.
   */
  interface FFITypeToJSCallbackArgsType {
    [FFIType.char]: number;
    [FFIType.int8_t]: number;
    [FFIType.uint8_t]: number;
    [FFIType.int16_t]: number;
    [FFIType.uint16_t]: number;
    [FFIType.int32_t]: number;
    [FFIType.uint32_t]: number;
    [FFIType.int64_t]: bigint;
    [FFIType.uint64_t]: bigint;
    [FFIType.double]: number;
    [FFIType.float]: number;
    [FFIType.bool]: boolean;
    [FFIType.ptr]: Pointer | null;
    [FFIType.void]: undefined;
    [FFIType.cstring]: Pointer | null;
    [FFIType.i64_fast]: number | bigint;
    [FFIType.u64_fast]: number | bigint;
    [FFIType.function]: Pointer | null;
    [FFIType.napi_env]: unknown;
    [FFIType.napi_value]: unknown;
    [FFIType.buffer]: NodeJS.TypedArray | DataView;
  }
  /**
   * Values a {@link JSCallback} may return to native code.
   *
   * Conversion happens without the JavaScript-side coercion that calls into
   * native functions get, so pointer-typed returns accept a {@link Pointer},
   * a TypedArray or DataView (its backing store address is used), or `null`,
   * but not a {@link CString} or {@link JSCallback}.
   */
  interface FFITypeToJSCallbackReturnsType {
    [FFIType.char]: number;
    [FFIType.int8_t]: number;
    [FFIType.uint8_t]: number;
    [FFIType.int16_t]: number;
    [FFIType.uint16_t]: number;
    [FFIType.int32_t]: number;
    [FFIType.uint32_t]: number;
    [FFIType.int64_t]: number | bigint;
    [FFIType.uint64_t]: number | bigint;
    [FFIType.double]: number;
    [FFIType.float]: number;
    [FFIType.bool]: boolean;
    [FFIType.ptr]: NodeJS.TypedArray | DataView | Pointer | null;
    [FFIType.void]: void;
    [FFIType.cstring]: NodeJS.TypedArray | DataView | Pointer | null;
    [FFIType.i64_fast]: number | bigint;
    [FFIType.u64_fast]: number | bigint;
    [FFIType.function]: Pointer | null;
    [FFIType.napi_env]: unknown;
    [FFIType.napi_value]: unknown;
    [FFIType.buffer]: NodeJS.TypedArray | DataView;
  }
  interface FFITypeStringToType {
    ["char"]: FFIType.char;
    ["int8_t"]: FFIType.int8_t;
    ["i8"]: FFIType.i8;
    ["uint8_t"]: FFIType.uint8_t;
    ["u8"]: FFIType.u8;
    ["int16_t"]: FFIType.int16_t;
    ["i16"]: FFIType.i16;
    ["uint16_t"]: FFIType.uint16_t;
    ["u16"]: FFIType.u16;
    ["int32_t"]: FFIType.int32_t;
    ["i32"]: FFIType.i32;
    ["int"]: FFIType.int;
    ["uint32_t"]: FFIType.uint32_t;
    ["u32"]: FFIType.u32;
    ["int64_t"]: FFIType.int64_t;
    ["i64"]: FFIType.i64;
    ["uint64_t"]: FFIType.uint64_t;
    ["u64"]: FFIType.u64;
    ["double"]: FFIType.double;
    ["f64"]: FFIType.f64;
    ["float"]: FFIType.float;
    ["f32"]: FFIType.f32;
    ["bool"]: FFIType.bool;
    ["ptr"]: FFIType.ptr;
    ["pointer"]: FFIType.pointer;
    ["void*"]: FFIType.ptr;
    ["char*"]: FFIType.ptr;
    ["void"]: FFIType.void;
    ["cstring"]: FFIType.cstring;
    ["i64_fast"]: FFIType.i64_fast;
    ["u64_fast"]: FFIType.u64_fast;
    ["function"]: FFIType.function;
    ["callback"]: FFIType.function;
    ["fn"]: FFIType.function;
    ["usize"]: FFIType.uint64_t;
    ["size_t"]: FFIType.uint64_t;
    ["isize"]: FFIType.int64_t;
    ["c_int"]: FFIType.int32_t;
    ["c_uint"]: FFIType.uint32_t;
    ["napi_env"]: FFIType.napi_env;
    ["napi_value"]: FFIType.napi_value;
    ["buffer"]: FFIType.buffer;
  }

  type FFITypeOrString = FFIType | keyof FFITypeStringToType;

  interface FFIFunction {
    /**
     * Arguments to an FFI function (C ABI)
     *
     * Defaults to an empty array, which means no arguments.
     *
     * To pass a pointer, use "ptr" or "pointer" as the type name. To get a pointer, see {@link ptr}.
     *
     * @example
     * From JavaScript:
     * ```ts
     * import { dlopen, FFIType, suffix } from "bun:ffi"
     *
     * const lib = dlopen(`adder.${suffix}`, {
     * 	add: {
     * 		// FFIType can be used or you can pass string labels.
     * 		args: [FFIType.i32, "i32"],
     * 		returns: "i32",
     * 	},
     * })
     * lib.symbols.add(1, 2)
     * ```
     * In C:
     * ```c
     * int add(int a, int b) {
     *   return a + b;
     * }
     * ```
     */
    readonly args?: readonly FFITypeOrString[];
    /**
     * Return type of an FFI function (C ABI)
     *
     * Defaults to {@link FFIType.void}
     *
     * To pass a pointer, use "ptr" or "pointer" as the type name. To get a pointer, see {@link ptr}.
     *
     * @example
     * From JavaScript:
     * ```ts
     * import { dlopen, CString } from "bun:ffi"
     *
     * const lib = dlopen('z', {
     *    version: {
     *      returns: "ptr",
     *   }
     * });
     * console.log(new CString(lib.symbols.version()));
     * ```
     * In C:
     * ```c
     * char* version()
     * {
     *  return "1.0.0";
     * }
     * ```
     */
    readonly returns?: FFITypeOrString;

    /**
     * Function pointer to the native function
     *
     * If provided, Bun uses this pointer instead of looking the function up
     * with `dlsym()`. It should not be null (0).
     *
     * Use this when the library is already loaded, or when the module is also
     * using Node-API.
     */
    readonly ptr?: Pointer | bigint;

    /**
     * Whether C/FFI code can call this function from a separate thread.
     *
     * Only supported with {@link JSCallback}.
     *
     * This does not make the function run in a separate thread; the
     * application or library is still responsible for its own threading.
     *
     * Enabling it adds a small cost to every call, so it's only worth it when
     * that cost is smaller than what you gain from running the function on a
     * separate thread.
     *
     * @default false
     */
    readonly threadsafe?: boolean;
  }

  type Symbols = Readonly<Record<string, FFIFunction>>;

  interface Library<Fns extends Symbols> {
    symbols: ConvertFns<Fns>;

    /**
     * `dlclose` the library, unloading the symbols and freeing allocated memory.
     *
     * Once called, the library is no longer usable.
     *
     * Calling a function from a library that has been closed is undefined behavior.
     */
    close(): void;
  }

  type ToFFIType<T extends FFITypeOrString> = T extends FFIType ? T : T extends string ? FFITypeStringToType[T] : never;

  const FFIFunctionCallableSymbol: unique symbol;
  type ConvertFn<Fn extends FFIFunction> = {
    (
      ...args: Fn["args"] extends infer A extends readonly FFITypeOrString[]
        ? { [L in keyof A]: FFITypeToArgsType[ToFFIType<A[L]>] }
        : // eslint-disable-next-line @definitelytyped/no-single-element-tuple-type
          [unknown] extends [Fn["args"]]
          ? []
          : never
    ): [unknown] extends [Fn["returns"]] // eslint-disable-next-line @definitelytyped/no-single-element-tuple-type
      ? undefined
      : FFITypeToReturnsType[ToFFIType<NonNullable<Fn["returns"]>>];
    __ffi_function_callable: typeof FFIFunctionCallableSymbol;
  };
  type ConvertFns<Fns extends Symbols> = {
    [K in keyof Fns]: ConvertFn<Fns[K]>;
  };

  /**
   * The JavaScript function passed to a {@link JSCallback}.
   *
   * Argument and return types are derived from the `definition`:
   * arguments arrive converted per {@link FFITypeToJSCallbackArgsType} and the
   * return value must satisfy {@link FFITypeToJSCallbackReturnsType}.
   */
  type JSCallbackFunction<Def extends FFIFunction = FFIFunction> = {
    // A method signature (vs a function type) keeps parameter checking
    // bivariant, so a narrower handwritten `(ptr: Pointer) => void` stays
    // assignable where the derived type is `(ptr: Pointer | null) => void`.
    fn(
      ...args: Def["args"] extends infer A extends readonly FFITypeOrString[]
        ? { [L in keyof A]: FFITypeToJSCallbackArgsType[ToFFIType<A[L]>] }
        : // eslint-disable-next-line @definitelytyped/no-single-element-tuple-type
          [unknown] extends [Def["args"]]
          ? []
          : never
    ): [unknown] extends [Def["returns"]] // eslint-disable-next-line @definitelytyped/no-single-element-tuple-type
      ? void
      : FFITypeToJSCallbackReturnsType[ToFFIType<NonNullable<Def["returns"]>>];
  }["fn"];

  /**
   * Open a native library and load symbols from it
   *
   * @param name Library name or file path, passed to `dlopen()`
   * @param symbols Map of symbols to load where the key is the symbol name and the value is the {@link FFIFunction}
   *
   * @example
   *
   * ```js
   * import {dlopen} from 'bun:ffi';
   *
   * const lib = dlopen("duckdb.dylib", {
   *   get_version: {
   *     returns: "cstring",
   *     args: [],
   *   },
   * });
   * lib.symbols.get_version();
   * // "1.0.0"
   * ```
   *
   * Bun uses [tinycc](https://github.com/TinyCC/tinycc) to just-in-time
   * compile C wrappers that convert JavaScript types to C types and back.
   *
   * @category FFI
   */
  function dlopen<const Fns extends Record<string, FFIFunction>>(
    name: string | import("bun").BunFile | URL,
    symbols: Fns,
  ): Library<Fns>;

  /**
   * **Experimental:** Compile ISO C11 source code using TinyCC, and make {@link symbols} available as functions to JavaScript.
   *
   * @param options Source file, symbols to expose, and compiler options
   * @returns A library whose `symbols` are the compiled C functions
   *
   * @example
   * ## Hello, World!
   *
   * JavaScript:
   * ```js
   * import { cc } from "bun:ffi";
   * import source from "./hello.c" with {type: "file"};
   * const {symbols: {hello}} = cc({
   *   source,
   *   symbols: {
   *     hello: {
   *       returns: "cstring",
   *       args: [],
   *     },
   *   },
   * });
   * // "Hello, World!"
   * console.log(hello());
   * ```
   *
   * `./hello.c`:
   * ```c
   * #include <stdio.h>
   * const char* hello() {
   *   return "Hello, World!";
   * }
   * ```
   */
  function cc<const Fns extends Record<string, FFIFunction>>(options: {
    /**
     * File path to an ISO C11 source file to compile and link
     */
    source: string | import("bun").BunFile | URL;

    /**
     * Library names to link against
     *
     * Equivalent to `-l` option in gcc/clang.
     */
    library?: string[] | string;

    /**
     * Include directories to pass to the compiler
     *
     * Equivalent to `-I` option in gcc/clang.
     */
    include?: string[] | string;

    /**
     * Map of symbols to load where the key is the symbol name and the value is the {@link FFIFunction}
     */
    symbols: Fns;

    /**
     * Map of symbols to define where the key is the symbol name and the value is the symbol value
     *
     * Equivalent to `-D` option in gcc/clang.
     *
     * @example
     * ```js
     * import { cc } from "bun:ffi";
     * import source from "./hello.c" with {type: "file"};
     * const {symbols: {hello}} = cc({
     *   source,
     *   define: {
     *     "NDEBUG": "1",
     *   },
     *   symbols: {
     *     hello: {
     *       returns: "cstring",
     *       args: [],
     *     },
     *   },
     * });
     * ```
     */
    define?: Record<string, string>;

    /**
     * Flags to pass to the compiler, for example to link against macOS
     * frameworks. Bun makes no guarantees about which compiler version is
     * used.
     *
     * @default "-std=c11 -Wl,--export-all-symbols -g -O2"
     *
     * @example
     * ```js
     * import { cc } from "bun:ffi";
     * import source from "./hello.c" with {type: "file"};
     * const {symbols: {hello}} = cc({
     *   source,
     *   flags: ["-framework CoreFoundation", "-framework Security"],
     *   symbols: {
     *     hello: {
     *       returns: "cstring",
     *       args: [],
     *     },
     *   },
     * });
     * ```
     */
    flags?: string | string[];
  }): Library<Fns>;

  /**
   * Turn a native library's function pointer into a JavaScript function
   *
   * Libraries using Node-API & bun:ffi in the same module could use this to skip an extra dlopen() step.
   *
   * @param fn {@link FFIFunction} declaration. `ptr` is required
   *
   * @example
   *
   * ```js
   * import {CFunction} from 'bun:ffi';
   *
   * const getVersion = new CFunction({
   *   returns: "cstring",
   *   args: [],
   *   ptr: myNativeLibraryGetVersion,
   * });
   * getVersion();
   * getVersion.close();
   * ```
   *
   * Bun uses [tinycc](https://github.com/TinyCC/tinycc) to just-in-time
   * compile a C wrapper that converts JavaScript types to C types and back.
   */
  function CFunction<const Fn extends FFIFunction & { ptr: Pointer }>(
    fn: Fn,
  ): ConvertFn<Fn> & {
    /**
     * Free the memory allocated by the wrapping function
     */
    close(): void;
  };

  /**
   * Link a map of symbols to JavaScript functions
   *
   * Use this for native libraries that are already loaded, for example by
   * Node-API, to skip loading them a second time. You usually want
   * {@link dlopen} instead.
   *
   * @param symbols Map of symbols to load where the key is the symbol name and the value is the {@link FFIFunction}
   *
   * @example
   *
   * ```js
   * import { linkSymbols } from "bun:ffi";
   *
   * const [majorPtr, minorPtr, patchPtr] = getVersionPtrs();
   *
   * const lib = linkSymbols({
   *   // Unlike with dlopen(), the names here can be whatever you want
   *   getMajor: {
   *     returns: "cstring",
   *     args: [],
   *
   *     // Since this doesn't use dlsym(), you have to provide a valid ptr
   *     // That ptr could be a number or a bigint
   *     // An invalid pointer will crash your program.
   *     ptr: majorPtr,
   *   },
   *   getMinor: {
   *     returns: "cstring",
   *     args: [],
   *     ptr: minorPtr,
   *   },
   *   getPatch: {
   *     returns: "cstring",
   *     args: [],
   *     ptr: patchPtr,
   *   },
   * });
   *
   * const [major, minor, patch] = [
   *   lib.symbols.getMajor(),
   *   lib.symbols.getMinor(),
   *   lib.symbols.getPatch(),
   * ];
   * ```
   *
   * Bun uses [tinycc](https://github.com/TinyCC/tinycc) to just-in-time
   * compile C wrappers that convert JavaScript types to C types and back.
   */
  function linkSymbols<const Fns extends Record<string, FFIFunction>>(symbols: Fns): Library<Fns>;

  /**
   * Read a pointer as a {@link Buffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * Bun catches some invalid pointers, but not all. Passing an invalid
   * pointer, or reading past the end of the memory it points to, can crash
   * the program or cause undefined behavior.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   */
  function toBuffer(ptr: Pointer, byteOffset?: number, byteLength?: number): Buffer;

  /**
   * Read a pointer as an {@link ArrayBuffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * Bun catches some invalid pointers, but not all. Passing an invalid
   * pointer, or reading past the end of the memory it points to, can crash
   * the program or cause undefined behavior.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   */
  function toArrayBuffer(ptr: Pointer, byteOffset?: number, byteLength?: number): ArrayBuffer;

  /**
   * Read a value directly from a memory address, without creating a
   * `DataView` or `ArrayBuffer`
   */
  namespace read {
    /**
     * Read an unsigned 8-bit integer at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function u8(ptr: Pointer, byteOffset?: number): number;
    /**
     * Read a signed 8-bit integer at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function i8(ptr: Pointer, byteOffset?: number): number;
    /**
     * Read an unsigned 16-bit integer at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function u16(ptr: Pointer, byteOffset?: number): number;
    /**
     * Read a signed 16-bit integer at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function i16(ptr: Pointer, byteOffset?: number): number;
    /**
     * Read an unsigned 32-bit integer at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function u32(ptr: Pointer, byteOffset?: number): number;
    /**
     * Read a signed 32-bit integer at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function i32(ptr: Pointer, byteOffset?: number): number;
    /**
     * Read a 32-bit float at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function f32(ptr: Pointer, byteOffset?: number): number;
    /**
     * Read an unsigned 64-bit integer at `ptr + byteOffset`, as a `bigint`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function u64(ptr: Pointer, byteOffset?: number): bigint;
    /**
     * Read a signed 64-bit integer at `ptr + byteOffset`, as a `bigint`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function i64(ptr: Pointer, byteOffset?: number): bigint;
    /**
     * Read a 64-bit double at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function f64(ptr: Pointer, byteOffset?: number): number;
    /**
     * Read a pointer at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function ptr(ptr: Pointer, byteOffset?: number): number;
    /**
     * Read a pointer-sized signed integer (`intptr_t`) at `ptr + byteOffset`
     *
     * Behaves like `DataView`, but is usually faster because it doesn't
     * create a `DataView` or `ArrayBuffer`.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @param ptr The memory address to read
     * @param byteOffset bytes to skip before reading
     */
    function intptr(ptr: Pointer, byteOffset?: number): number;
  }

  /**
   * Get the pointer backing a {@link TypedArray} or {@link ArrayBuffer}
   *
   * Use this to pass a {@link TypedArray} or {@link ArrayBuffer} to a C
   * function. For performance reasons, FFI does not convert typed arrays to C
   * pointers automatically.
   *
   * @param view The typed array, `ArrayBuffer`, or `DataView` to get the pointer of
   * @param byteOffset Optional offset into the view, in bytes
   *
   * @example
   *
   * From JavaScript:
   * ```js
   * const array = new Uint8Array(10);
   * const rawPtr = ptr(array);
   * myFFIFunction(rawPtr);
   * ```
   * To C:
   * ```c
   * void myFFIFunction(char* rawPtr) {
   *  // Do something with rawPtr
   * }
   * ```
   *
   * @category FFI
   */
  function ptr(view: NodeJS.TypedArray | ArrayBufferLike | DataView, byteOffset?: number): Pointer;

  /**
   * Get a string from a UTF-8 encoded C string.
   *
   * If `byteLength` is not provided, the string is assumed to be null-terminated.
   *
   * Bun catches some invalid pointers, but not all. Passing an invalid
   * pointer, or reading past the end of the memory it points to, can crash
   * the program or cause undefined behavior.
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * console.log(new CString(ptr));
   * ```
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * // print the first 4 characters
   * console.log(new CString(ptr, 0, 4));
   * ```
   *
   * @category FFI
   */
  class CString extends String {
    /**
     * Get a string from a UTF-8 encoded C string.
     *
     * If `byteLength` is not provided, the string is assumed to be null-terminated.
     *
     * Bun catches some invalid pointers, but not all. Passing an invalid
     * pointer, or reading past the end of the memory it points to, can crash
     * the program or cause undefined behavior.
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * console.log(new CString(ptr));
     * ```
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * // print the first 4 characters
     * console.log(new CString(ptr, 0, 4));
     * ```
     *
     * @param ptr The pointer to the C string
     * @param byteOffset bytes to skip before reading
     * @param byteLength bytes to read
     */
    constructor(ptr: Pointer, byteOffset?: number, byteLength?: number);

    /**
     * The pointer to the C string
     *
     * The `CString` is a clone of the string, so the instance stays safe to
     * use after the memory at `ptr` has been freed.
     */
    ptr: Pointer;
    byteOffset?: number;
    byteLength?: number;

    /**
     * Get the {@link ptr} as an `ArrayBuffer`
     *
     * A `null` or empty `ptr` returns an `ArrayBuffer` with `byteLength` 0
     */
    get arrayBuffer(): ArrayBuffer;
  }

  /**
   * Pass a JavaScript function to FFI (Foreign Function Interface)
   */
  class JSCallback<const Def extends FFIFunction = FFIFunction> {
    /**
     * Wrap a JavaScript function so it can be passed to C with `bun:ffi`
     *
     * The callback's parameter and return types are inferred from
     * `definition`, so a mismatch between the declared FFI types and the
     * JavaScript function is a type error.
     *
     * @param callback The JavaScript function to be called
     * @param definition The C function definition
     */
    constructor(callback: JSCallbackFunction<Def>, definition: Def);

    /**
     * The pointer to the C function
     *
     * Becomes `null` once {@link JSCallback.prototype.close} is called
     */
    readonly ptr: Pointer | null;

    /**
     * Whether the callback can be called from a different thread
     */
    readonly threadsafe: boolean;

    /**
     * Free the memory allocated for the callback
     *
     * If called multiple times, does nothing after the first call.
     */
    close(): void;
  }

  /**
   * View the generated C code for FFI bindings
   *
   * You probably won't need this unless there's a bug in the FFI bindings
   * generator or you're just curious.
   */
  function viewSource(symbols: Symbols, is_callback?: false): string[];
  function viewSource(callback: FFIFunction, is_callback: true): string;

  /**
   * Platform-specific file extension for dynamic libraries, without the
   * leading "."
   *
   * @example
   * ```js
   * "dylib" // macOS
   * ```
   *
   * @example
   * ```js
   * "so" // linux
   * ```
   */
  const suffix: string;
}
