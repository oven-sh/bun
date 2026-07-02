# bun:ffi - Bun 2.0 breaking-change candidates

All runtime claims below were reproduced on the in-container `bun 1.4.0` against this checkout's
source. `bun:ffi` is already labeled experimental (`docs/runtime/ffi.mdx:7`), so the cost of
breaking it is unusually low and the payoff unusually high.

### Pointers are JS `number`s (lossy f64 doubles)

what: Native pointers are round-tripped through an IEEE-754 double (`Pointer = number & {__pointer__: null}`), not an opaque handle or bigint.
where: `/workspace/bun/packages/bun-types/ffi.d.ts:339`; `/workspace/bun/src/jsc/JSValue.rs:94-105` (`from_ptr_address = js_double_number(addr as f64)`, `as_ptr_address = as_number() as usize`); `/workspace/bun/src/runtime/ffi/FFI.h:245-253` (`PTR_TO_JSVALUE`: `val.asDouble = (double)(uintptr_t)ptr`); `/workspace/bun/src/runtime/ffi/FFIObject.rs:914-918`; `/workspace/bun/docs/runtime/ffi.mdx:355-367`.
evidence: Issue #29346 (closed): "Passing a JavaScript number (returned from a previous FFI call) as a `'ptr'` argument to another FFI function causes a segfault on Linux x64. The crash address is `0xFFFFFFFFFFFFFFFF`, suggesting the number is being corrupted during marshaling. Declaring the same argument as `'u64'` and passing a BigInt works correctly." Issue #22751 (closed), same class. The docs themselves admit the type can't represent all pointer-like values: "**Windows Note**: The Windows API type HANDLE does not represent a virtual address, and using `ptr` for it does _not_ work as expected. Use `u64`" (`ffi.mdx:365`). The docs' justification is also arithmetically wrong: "64-bit processors support up to 52 bits of addressable space ... JavaScript numbers support 53 bits of usable space, which leaves about 11 bits of extra space" (`ffi.mdx:361`) - that's 1 bit, and x86-64 LA57 kernels already expose 56-bit user VAs. Meanwhile the implementation's own bound is `MAX_ADDRESSABLE_MEMORY = (1<<56)-1` (`FFIObject.rs:916-918`), **above** a double's 2^53 exact-integer range, so `ptr()` accepts addresses that `from_ptr_address`/`as_ptr_address` will silently corrupt (only a `debug_assert!` at `FFIObject.rs:482` checks the round-trip). The module itself concedes 64-bit ints need BigInt - `read.u64`/`read.i64` return `bigint` (`FFIObject.rs:400,410`) - yet `read.ptr` and `read.intptr` read the same 8 bytes and return a lossy `f64` (`FFIObject.rs:325-326, 365-366`).
why bad: Silent pointer corruption on platforms with large address spaces is an unfixable-by-design memory-safety hazard; Deno hit the identical problem and broke compat in 1.31 to move `Deno.UnsafePointer` from `number` to an opaque `PointerObject` for exactly this reason.
bun 2.0 proposal: Make `Pointer` an opaque, non-arithmetic object (or at minimum `bigint`). Keep the NaN-boxing trick as an internal fast path; stop exposing the double to users. Drop the "Use `u64` for HANDLE" caveat by making `ptr` actually hold 64 bits.
blast radius: high - every `bun:ffi` consumer does arithmetic on pointers-as-numbers.
confidence: high.

### `lib.symbols.<name>.ptr` is a different (broken) pointer encoding than everything else

what: Every dlopen'd/cc'd symbol function gets a `.ptr` property computed with `std::bit_cast<double>(functionPointer)` - the raw 64 pointer bits reinterpreted as a double - which is a denormal garbage value, incompatible with every other `ptr` in the module.
where: `/workspace/bun/src/jsc/bindings/JSFFIFunction.cpp:114-128`; propagated by `/workspace/bun/src/js/bun/ffi.ts:410` (`wrap.ptr = functionToCall.ptr`).
evidence: Verified live: `dlopen("libc.so.6",{getpid:...}).symbols.getpid.ptr === 1.6542783505504e-311` (a denormal), while `ptr(buf) === 140394041966896` and `new JSCallback(...).ptr === 4237497518735` (real integer addresses). Feeding `symbols.getpid.ptr` back into `linkSymbols({x:{ptr: ...}})` fails with `TypeError: Symbol "x" is missing a "ptr" field` because `as_ptr_address()` on a denormal is `0` (`ffi_body.rs:1831-1843`). The C++ comment on the very line admits the shape is wrong: "We should only expose the \"ptr\" field when it's a JSCallback for bun:ffi. Not for internal usages of this function type. **We should also consider a separate JSFunction type for our usage to not have this branch in the first place...**" (`JSFFIFunction.cpp:119-121`). `.ptr`/`.native` are also absent from the `ConvertFns` type in `ffi.d.ts:536-550`.
why bad: Three things named `ptr` in one module (the `ptr()` function, the `FFIFunction.ptr` input field, and `symbols.foo.ptr`) have two incompatible encodings; `symbols.foo.ptr` is 100% unusable and has silently been so for years.
bun 2.0 proposal: Delete `symbols.<name>.ptr` and `symbols.<name>.native` (or fix `.ptr` to the real address and type them). Use a dedicated JSFFIFunction subclass as the comment says.
blast radius: low - the value has never been usable, so nothing can depend on it.
confidence: high.

### Native validation failures are *returned* as Error objects, not thrown; `CString` turns them into string content

what: `ptr()`, `toArrayBuffer()`, `toBuffer()` return a `TypeError` *value* on bad input instead of throwing; `new CString(badPtr)` silently uses the error's `.toString()` as the string's characters.
where: `/workspace/bun/src/runtime/ffi/FFIObject.rs:426-486` (`ptr_` returns `global_this.to_invalid_arguments(...)`), `:502-596` (`get_ptr_slice` → `ValueOrError::Err(v)` → `Ok(v)`), `:624-625`, `:685-686`; the JS wrappers that *should* compensate only do so for `dlopen`/`cc`/`linkSymbols` (`/workspace/bun/src/js/bun/ffi.ts:447,495,526` - `if (Error.isError(result)) throw result`) while `ptr`/`toArrayBuffer`/`toBuffer` are raw re-exports (`ffi.ts:69-71`).
evidence: Verified live - all of these *return* a `TypeError` object with exit code 0: `ptr(new Uint8Array(0))` → `TypeError "ArrayBufferView must have a length > 0..."`; `ptr("x")` → `TypeError "Expected ArrayBufferView but received JSType(2)"` (also leaks an internal `JSType(2)` debug string to users); `toArrayBuffer(p,0,0)` → `TypeError "length must be > 0..."`; `toArrayBuffer(0)`/`toBuffer(0)` → `TypeError "ptr cannot be zero, that would segfault Bun :("`. And `String(new CString(0xDEADBEEF))` is literally `"TypeError [ERR_INVALID_ARG_TYPE]: ptr to invalid memory, that would segfault Bun :("` because `class CString extends String` passes the returned Error through `super()` (`ffi.ts:118-126`). `read.*` and `dlopen` throw. TypeScript says `ptr()` returns `Pointer` and `toArrayBuffer()` returns `ArrayBuffer`.
why bad: Half the module throws, half returns errors, one stringifies them; the returned `TypeError` then flows into the next FFI call as an "argument". This is undiagnosable.
bun 2.0 proposal: Throw from every native entry point (or mark them `[[Throws]]` in the binding). Route through `$ERR_*`/ErrorCode. Allow `byteLength === 0` and return an empty view instead of a `TypeError`.
blast radius: medium - code written against the (insane) current behavior is essentially nonexistent, but going from "returns" to "throws" is observable.
confidence: high.

### `toBuffer` and `toArrayBuffer` have the same signature but opposite memory ownership

what: `toBuffer(ptr, off, len)` with no finalizer *adopts* the foreign pointer (GC `mi_free`s it); `toArrayBuffer(ptr, off, len)` with the same arguments *borrows* it.
where: `/workspace/bun/src/runtime/ffi/FFIObject.rs:488-500` (audit comment), `:731-733` (`JSValue::create_buffer` installs `MarkedArrayBuffer_deallocator`).
evidence: In-source comment: "`to_buffer` does the same when a finalizer is given, but WITHOUT one it falls back to `JSValue::create_buffer`, which installs `MarkedArrayBuffer_deallocator` and `mi_free`s the caller-owned slice on GC - **free-foreign-memory footgun, see PR #31753**" (`FFIObject.rs:492-496`). PR #31753 (open): "`bun:ffi.toBuffer(ptr, offset, len)` without an explicit finalizer adopted the caller's pointer as **owned** ... That foreign-memory free is an ASAN bad-free and a release `SIGSEGV`." Additionally, the deallocator params (4th/5th args) are documented in `docs/runtime/ffi.mdx:441-478` but absent from both `toBuffer`/`toArrayBuffer` declarations in `ffi.d.ts:788,803`.
why bad: Two sibling functions with identical documented signatures differ in whether the process segfaults on GC. The only memory-ownership feature the API has isn't even typed.
bun 2.0 proposal: Land #31753 (make both borrow by default). Replace the positional overload dance (`toArrayBuffer(ptr, off, len, ctxOrCb, cb?)`) with an explicit options object `{byteLength, deallocator, context}`.
blast radius: low - adopting behavior is a crash, not something anyone relies on.
confidence: high.

### `byteLength` defaults to `strlen()` for `toArrayBuffer`/`toBuffer`, and zero-length views are forbidden

what: Omitting `byteLength` on `toArrayBuffer`/`toBuffer` scans the pointed-to memory for a NUL byte to size the *binary* buffer; passing `byteLength: 0` is rejected.
where: `/workspace/bun/src/runtime/ffi/FFIObject.rs:590-595` (`// Scan for the NUL terminator. ... bun_core::ffi::cstr(addr).to_bytes().len()`), `:566-570` (`"length must be > 0. This usually means a bug in your code."`); `/workspace/bun/packages/bun-types/ffi.d.ts:778,793` ("If `byteLength` is not provided, the pointer is assumed to be 0-terminated."); `FFIObject.rs:438-442` (`ptr()` rejects zero-length views).
evidence: Verified live: `toArrayBuffer(ptr(new Uint8Array([1,2,3,0,5,6])))` → `byteLength === 3`. `toArrayBuffer(p,0,0)` → returns (not throws) a `TypeError`. `ptr(new Uint8Array(0))` → returns a `TypeError`.
why bad: ArrayBuffers model *binary* data; a `strlen` default is meaningless for it and an unbounded out-of-bounds scan (UB) for any allocation not containing a 0 byte. Rejecting length 0 means legitimately-empty native slices can't be represented at all.
bun 2.0 proposal: Make `byteLength` **required** on `toArrayBuffer`/`toBuffer` (keep the NUL-scan default only on `CString`, where it's the point). Allow `byteLength: 0`.
blast radius: medium - anyone calling `toArrayBuffer(ptr)` with one arg relies on the scan, but is already in UB territory.
confidence: high.

### FFIType is four mutually-inconsistent alias tables; the exported numeric enum members don't all work

what: The type-name vocabulary exists independently in the Rust validator, the JS `FFIType` object, the `.d.ts`, and the docs table, and they all disagree - including on which *exported enum members* are accepted.
where: `/workspace/bun/src/runtime/ffi/abi_type.rs:71-120` (`ABI_TYPE_LABEL`, the real validator), `:190` (`MAX = NapiValue as i32` = 19); `/workspace/bun/src/runtime/ffi/ffi_body.rs:1740,1781` ("// Reject Buffer (20); only the string-label path accepts it."); `/workspace/bun/src/js/bun/ffi.ts:1-61` (the runtime `FFIType` object); `/workspace/bun/packages/bun-types/ffi.d.ts:18-337,393-427`; `/workspace/bun/docs/runtime/ffi.mdx:128-154`.
evidence: All verified live. (a) `args: [FFIType.buffer]` → `Error: invalid ABI type`, but `args: ["buffer"]` works - the exported enum member is rejected by the numeric path. (b) `args: ["size_t"]` compiles natively (Rust accepts `size_t`, `abi_type.rs:105`) then throws in the JS wrapper: `TypeError: Unsupported type size_t. Must be one of: 0, 1, 10, 11, 12, 13, ...` - the error message enumerates internal numeric hash keys because `size_t` is missing from the JS `FFIType` object. (c) The runtime object has 59 keys including `c_int`, `c_uint`, `char*`, `void*`, `isize`, `fn` - none in the `.d.ts`. (d) The `.d.ts` map is *wrong*: `["function"]: FFIType.pointer; // for now` and `["callback"]: FFIType.pointer; // for now` (`ffi.d.ts:421,423`), but they really map to `FFIType.function` (17), which has entirely different argument conversion. (e) The `.d.ts` declares a real TS `enum` (implying a reverse map) but the runtime is a plain object: `FFIType[5] === 5`, not `"int"`. (f) `FFITypeToReturnsType` allows `returns: FFIType.buffer` and `returns: FFIType.napi_env` (`ffi.d.ts:389,391`) which the runtime rejects: "Cannot return a buffer to JavaScript", "Cannot return napi_env to JavaScript" (`ffi_body.rs:1804-1817`). Issue #31534 (open, "Incomplete API coverage and discrepancies in `bun:ffi`") is a user independently documenting the same drift.
why bad: The core contract of the module - "which types can I say?" - has no single source of truth; the numeric enum and string aliases, advertised as interchangeable ("FFIType can be used or you can pass string labels", `ffi.d.ts:446`), are not.
bun 2.0 proposal: Pick **one** spelling per type (kill `isize`/`usize`/`size_t`/`c_int`/`c_uint`/`char*`/`void*`/`fn`/`callback` or generate them all from one table), generate the JS object, `.d.ts`, docs table, and Rust map from a single codegen source, and make the numeric enum either fully work or go away.
blast radius: medium - removing aliases breaks code using them; fixing the numeric `buffer` path is additive.
confidence: high.

### Integer argument coercion is per-type inconsistent and contradicts the documented contract

what: Out-of-range integer args are wrapped for `i8`/`i32`, saturated for `u8`/`u16`, and turned into garbage for `i16`, while the `.d.ts` says four separate times "When passing to an FFI function (C ABI), type coercion is not performed."
where: `/workspace/bun/src/js/bun/ffi.ts:161-271` (the `ffiWrappers` table); `/workspace/bun/packages/bun-types/ffi.d.ts:25,44,64,82,101,120,140,159`.
evidence: Verified live with a C identity library: `i8(200) === -56` (wrap), `u8(300) === 255` (saturate), `i16(40000) === -32768` (neither - the wrapper clamps to the out-of-range literal `32768`: `ffi.ts:164` `"val<=-32768?-32768:val>=32768?32768:val|0"`), `u16(70000) === 65535` (saturate). `i8` gets no clamp at all because `ffiWrappers.fill("val|0")` is never overridden for index 1 (`ffi.ts:161-162`). `uint32_t` carries a 17-line in-source essay defending a double-misinterpretation `|0` hack ("citation needed") that references issue **#7007** (`ffi.ts:167-184`) - #7007 ("FFIType.u32 misbehavior") is **still open**.
why bad: Undefined conversion semantics in an FFI boundary is the one thing an FFI must not have; every one of the four behaviors contradicts the published docs.
bun 2.0 proposal: Pick one rule (Node-API / Deno both truncate modulo 2^n, i.e. wrap) for *all* integer widths, document it, delete the #7007 hack, and stop generating wrappers with `new Function` string splicing so the table can't drift.
blast radius: medium - programs passing out-of-range ints were already getting nonsense, but the nonsense changes.
confidence: high.

### `cstring` means two different things depending on position

what: `FFIType.cstring` decodes a C string when used as `returns`, but is a bare alias of `ptr` when used in `args` - it neither encodes a JS string nor rejects one safely.
where: `/workspace/bun/packages/bun-types/ffi.d.ts:308-313` ("When used in `args`, it is equivalent to {@link FFIType.pointer}"); `/workspace/bun/src/js/bun/ffi.ts:290` (`ffiWrappers[FFIType.cstring] = ffiWrappers[FFIType.pointer]`).
evidence: Issue #16937 (closed): "Segmentation fault at address 0xFFFFFFFFFFFFFFFF passing JS string to FFI `cstring` argument" - a user declared `args: ["cstring"]` and passed a string, as the name invites. Today the wrapper throws `TypeError: "To convert a string to a pointer, encode it as a buffer"` (`ffi.ts:304-306`) - still an error, just a safer one.
why bad: A type whose semantics invert by position is a trap, and the .d.ts only apologizes for it in a doc comment.
bun 2.0 proposal: Either (a) make `cstring` in `args` accept a JS string and NUL-terminate + encode it (what every binding author expects), or (b) reject `cstring` in `args` entirely and force `"ptr"`.
blast radius: low - it already errors; (a) is effectively additive.
confidence: high.

### `CString extends String` (a String object wrapper)

what: The value returned for `returns: "cstring"` and by `new CString(ptr)` is a boxed `String` object, not a primitive string.
where: `/workspace/bun/src/js/bun/ffi.ts:118-152` (`class CString extends String`); `/workspace/bun/packages/bun-types/ffi.d.ts:1033` (`class CString extends String`); `/workspace/bun/docs/runtime/ffi.mdx:178-198`.
evidence: Verified live: `typeof cs === "object"`, `cs === "hi"` is `false`, `cs instanceof String` is `true`. And because `super()` is given whatever the native call returns, an invalid pointer makes the *error message* the string's content (see the return-vs-throw finding). `String` subclassing is the well-known "never use `new String()`" footgun (strict-equality, `typeof`, truthiness of `new CString(0)`, etc.).
why bad: It exists only to hang `.ptr`/`.byteOffset`/`.byteLength`/`.arrayBuffer` off the value, and in exchange breaks every primitive-string idiom. Every other runtime API in Bun returns primitive strings.
bun 2.0 proposal: Make `returns: "cstring"` return a primitive `string`. Replace `new CString(ptr, off, len)` with a plain function `cstring(ptr, off?, len?): string` (and `toArrayBuffer` already covers the byte view). Throw on invalid input.
blast radius: high - `new CString(...)` is in nearly every FFI example and user codebase; `cs.ptr` would be gone.
confidence: high.

### `JSCallback({ threadsafe: true })` is not thread-safe, can't return a value, and its only validation is dead code

what: The `threadsafe` option routes calls through `ScriptExecutionContext::postTaskTo` (fire-and-forget, return value discarded), only works when the calling thread is itself a Bun JS thread, and the guard meant to enforce `returns: "void"` never fires.
where: `/workspace/bun/src/jsc/bindings/JSFFIFunction.cpp:208-223` (`FFI_Callback_threadsafe_call` returns `void` and postTasks); `/workspace/bun/src/runtime/ffi/ffi_body.rs:1770-1829`; `/workspace/bun/docs/runtime/ffi.mdx:316-328`.
evidence: (a) Docs admit it: "Thread-safe callbacks work best when run from another thread that is running JavaScript code, that is, a [`Worker`]. **A future version of Bun will enable them to be called from any thread, such as new threads spawned by your native library** that Bun is not aware of." (`ffi.mdx:320`) - but calling back from a library-spawned thread is the *only* reason a threadsafe callback exists. (b) The guard is dead: `generate_symbol_for_function` checks `if function.threadsafe && return_type != ABIType::Void` (`ffi_body.rs:1819`) **before** `function.threadsafe = threadsafe` is assigned (`:1825-1829`), so it reads the out-param's default `false`. Verified live: `new JSCallback(()=>42, {returns:"i32", args:[], threadsafe:true})` is accepted; the C caller of that callback receives garbage. (c) Four open/recent issues: #28113 "Segfault when native code repeatedly invokes `JSCallback({ threadsafe: true })`" (open), #24529 "JSCallback invoked from different thread crashing after a while" (open), #24528, #15925.
why bad: An option named `threadsafe` that is documented to not actually be safe from arbitrary threads is strictly worse than not having it.
bun 2.0 proposal: Reimplement on a real MPSC channel keyed by a ref-counted handle that keeps the event loop alive (what N-API `napi_threadsafe_function` does), reject non-void returns for real, and until then remove/rename the option.
blast radius: medium - it's already broken for its stated purpose, but some Worker-to-Worker use works.
confidence: high.

### `close()` is both mandatory (else leak forever) and undefined behavior (if anything still references a symbol); `JSCallback` has no GC safety net but `CFunction` does

what: Lifetime management is "manual, with UB on one side and a permanent leak on the other", and the two closure-like types in the module handle it differently.
where: `/workspace/bun/src/runtime/ffi/ffi_body.rs:212-230` (`FFI::finalize`: "INTENTIONAL no-op when not closed ... teardown is owned by `close()`" → `bun_core::heap::release(self)` = deliberate leak); `/workspace/bun/packages/bun-types/ffi.d.ts:523-530` ("Calling a function from a library that has been closed is undefined behavior."); `/workspace/bun/src/js/bun/ffi.ts:82-116` (`JSCallback`, no `FinalizationRegistry`) vs `:541-564` (`CFunction` registers one: `cFunctionRegistry.register(...)`).
evidence: `FFI::finalize` comment: "Compiled trampolines / dlopen'd symbols may still be reachable from JS after the wrapper is GC'd ... Dropping the Box would run `Function::drop` → `tcc_delete()`, freeing the executable pages those JSFunctions still jump into." So if a user forgets `close()`, every dlopen'd library leaks its TinyCC JIT pages and dylib handle for the life of the process; if they call `close()` while any `symbols.foo` is still aliased, calling it is UB. A `JSCallback` additionally roots the JS closure via `JSC::Strong<JSFunction>` in `FFICallbackFunctionWrapper` (`JSFFIFunction.cpp:42-60`) until `.close()`. Issue #7582 (closed) "Memory leak when calling FFI function with JSCallback"; #19322 (open) "Dawn WebGPU methods seem to leak when called via FFI". `JSCallback` *does* implement `[Symbol.dispose]` (`ffi.ts:113-115`) but `Library` does not.
why bad: Two different lifetime policies inside one 600-line module; the default outcome for the common "never call close" case is a permanent leak, and the escape hatch is UB.
bun 2.0 proposal: Give `Library` a `FinalizationRegistry` fallback (like `CFunction` already has) and `[Symbol.dispose]`; give `JSCallback` the same `FinalizationRegistry` safety net; make `close()` neuter the symbol functions (throw) instead of UB.
blast radius: low - strictly additive safety.
confidence: high.

### `Bun.FFI` is a public, enumerable, undeclared duplicate of `bun:ffi`, and importing `bun:ffi` mutates it

what: The raw native host-function table is exposed as `Bun.FFI` on the global `Bun` object; `import "bun:ffi"` then `delete`s two of its properties as a side effect.
where: `/workspace/bun/src/js/bun/ffi.ts:68,79-80` (`var ffi = globalThis.Bun.FFI; ... delete ffi.callback; delete ffi.closeCallback;`), `:153-157, 277-288` (installs `__GlobalBunCString`, `__GlobalBunFFIPtrFunctionForWrapper`, `__GlobalBunFFIPtrArrayBufferViewFn` on `globalThis`).
evidence: Verified live: before `import("bun:ffi")`, `Object.keys(Bun.FFI)` includes `callback` and `closeCallback`; after the import they are gone. `Object.getOwnPropertyDescriptor(Bun,'FFI').enumerable === true`. `Bun.FFI` is not declared anywhere in `packages/bun-types/*.d.ts`. `Bun.FFI.dlopen` returns symbols **without** the JS-side type coercion wrappers, so it behaves differently from `bun:ffi`'s `dlopen`.
why bad: Undocumented, untyped, enumerable global surface that duplicates a module with different (more dangerous) semantics, plus three tamperable globals that the module's `new Function(...)`-generated wrappers call by bare name.
bun 2.0 proposal: Make `Bun.FFI` non-enumerable and internal (or remove it); stop mutating it on import; move the three `__Global*` helpers into closure scope instead of `globalThis`.
blast radius: low - it's undocumented.
confidence: high.

### The `native` export exists only to carry a stub that throws "Deprecated"

what: `bun:ffi` exports a `native` object with `{dlopen, callback}`, where `callback()` unconditionally throws, and `native.dlopen` is the raw un-wrapped native dlopen.
where: `/workspace/bun/src/js/bun/ffi.ts:414-419,575`.
evidence: `ffi.ts:416-418`: `callback: () => { throw new Error("Deprecated. Use new JSCallback(options, fn) instead"); }`. Verified live. `native` is absent from `ffi.d.ts` and from `docs/runtime/ffi.mdx`.
why bad: A public export whose whole job is to apologize for a pre-1.0 API is dead weight kept only for backward compatibility.
bun 2.0 proposal: Delete the `native` export.
blast radius: low - untyped and undocumented.
confidence: high.

### Four overlapping entry points with three naming conventions and inconsistent return shapes

what: `dlopen(path, syms)`, `linkSymbols(syms)`, `CFunction(sym)`, and `cc({source, symbols})` all build the same "compiled trampolines + close()" object, with gratuitous differences.
where: `/workspace/bun/src/js/bun/ffi.ts:443-564`; `/workspace/bun/packages/bun-types/ffi.d.ts:578-773`; `/workspace/bun/docs/runtime/ffi.mdx:225-276`.
evidence: (a) `dlopen` already accepts a `ptr` per symbol and skips `dlsym` for it (`ffi_body.rs:1549`), making `linkSymbols` redundant; `CFunction(x)` is literally `linkSymbols({cf: x}).symbols.cf` with a `FinalizationRegistry` bolted on (`ffi.ts:546-564`). (b) `dlopen` and `cc` bind `close` with the in-source admission `// Bind it because it's a breaking change to not do so / // Previously, it didn't need to be bound` (`ffi.ts:469-471, 517-519`) - but `linkSymbols` does **not**; verified live: `const {close} = linkSymbols(...); close()` throws `TypeError: Expected this to be instanceof FFI`, while the same pattern on `dlopen` works. (c) Naming: `dlopen`/`linkSymbols`/`cc` are functions, `CFunction`/`JSCallback`/`CString` are PascalCase, but `CFunction` is a factory, not a class - the official docs nonetheless write `new CFunction({...})` (`ffi.mdx:236`). Issue #31534 (open) calls this out: "`CFunction` is a factory function that directly returns a closure ... not a class." (d) `CFunction` returns the bare function with `.close()` on it; the other three return `{symbols, close}`.
why bad: Four ways to do one thing, each with a different bug.
bun 2.0 proposal: Keep `dlopen` (accepting `ptr` per symbol) and `cc`. Delete `linkSymbols` and `CFunction`. Always bind `close` (or make `Library` a real class with a `[Symbol.dispose]`).
blast radius: medium - `CFunction`/`linkSymbols` are documented and used, but mechanically migratable to `dlopen`.
confidence: high.

### `viewSource(x, isCallback)` is a boolean trap that also freezes an implementation detail into the public API

what: A `boolean` second parameter changes both the accepted shape of the first argument (symbols map vs single `FFIFunction`) and the return type (`string[]` vs `string`), and the function's only purpose is to dump TinyCC-generated C.
where: `/workspace/bun/packages/bun-types/ffi.d.ts:1112-1119`; `/workspace/bun/src/runtime/ffi/FFIObject.rs:810-816`; `/workspace/bun/src/runtime/ffi/ffi_body.rs:1370-1417`.
evidence: Verified live: `typeof viewSource(x,true) === "string"`, `Array.isArray(viewSource(x,false)) === true`. The .d.ts doc for it: "You probably won't need this unless there's a bug in the FFI bindings generator or you're just curious." (`ffi.d.ts:1113-1116`). Issue #31534 notes it is "entirely omitted from the documentation."
why bad: A public API that exists for debugging the implementation and whose contract is "the exact text of our codegen" can never change without breaking someone; the boolean overload is the textbook anti-pattern.
bun 2.0 proposal: Remove it from the public module (move behind `bun:internal-for-testing`), or split into `viewSource(symbols)` / `viewCallbackSource(def)`.
blast radius: low.
confidence: high.

### `cc()` is an in-process C compiler with missing knobs, a broken option, and no `--compile` story

what: The experimental `cc` API can't express a library *search path*, has a dead Rust field for it, isn't supported by `bun build --compile`, and types lie about `source`.
where: `/workspace/bun/packages/bun-types/ffi.d.ts:583-691`; `/workspace/bun/src/runtime/ffi/ffi_body.rs:232-260, 973-1250`.
evidence: (a) Only `library` (→ `-l`) and `include` (→ `-I`) are parsed from JS (`ffi_body.rs:1022-1026, 1110-1112`); `CompileC.library_dirs` exists (`ffi_body.rs:238`) and is iterated at compile time (`:826-831`) but **nothing ever populates it** - there is no `-L` option, only raw `flags`. Issue #20969 (open) asks for exactly this. (b) Issue #24752 (open): "Bun `cc` C Compiler not supported for `bun build --compile`"; #30962 (open) "Compiled executable leaks embedded bun:ffi native temp files"; #26249 (closed, NixOS headers), #14545 (open, Windows headers). (c) `source` accepts `string[]` at runtime (`ffi.ts:485-491`, `ffi_body.rs:1121-1135`) but is typed only `string | BunFile | URL` (`ffi.d.ts:621`). (d) Default flags ship `-g -O2` (`ffi.d.ts:672`, `ffi_body.rs:497,615`) - TinyCC barely honors `-O2`, and `-g` bloats production. (e) The entire module is compiled out in some builds: `if !bun_core::Environment::ENABLE_TINYCC { throw "... is not available in this build (TinyCC is disabled)" }` guards `dlopen`, `linkSymbols`, `callback`, and `cc` (`ffi_body.rs:974, 1263, 1428, 1619`) - so `bun:ffi` availability is a per-build question users can't feature-detect from the types.
why bad: `cc` is the most "experimental" part of an already-experimental module, with an option vocabulary that doesn't cover the common case.
bun 2.0 proposal: Add `libraryPath` (= `-L`), type `source` as `string | string[] | ...`, delete the dead `library_dirs` plumbing or wire it up, and decide whether `cc` survives at all given it can't ship inside `--compile` binaries.
blast radius: low for the option changes; medium if `cc` is removed.
confidence: high.

### `suffix` is only half of a cross-platform library name

what: `suffix` is the bare extension (`"so"`/`"dylib"`/`"dll"`, no dot), but the required `lib` *prefix* on POSIX is left to the user, so the docs' own template is wrong on Windows.
where: `/workspace/bun/src/js/bun/ffi.ts:63`; `/workspace/bun/packages/bun-types/ffi.d.ts:1121-1135`; `/workspace/bun/docs/runtime/ffi.mdx:20-24`.
evidence: Docs: ``const path = `libsqlite3.${suffix}`;`` (`ffi.mdx:24`) - on Windows this yields `libsqlite3.dll`, which is not the name of any Windows sqlite3 DLL (`sqlite3.dll`). The platform-specific convention `suffix` is meant to abstract is actually `lib<name>.so` / `lib<name>.dylib` / `<name>.dll` - two variables, not one.
why bad: The helper's only job is to make library paths portable and it can't.
bun 2.0 proposal: Add `libname(name)` → `"libfoo.so"` / `"libfoo.dylib"` / `"foo.dll"` (or teach `dlopen` a bare-name resolution mode, which it already half-has: it appends the platform `ext` for embedded bunfs files at `ffi_body.rs:1446-1457`). Deprecate `suffix`.
blast radius: low - additive.
confidence: medium (no issue # located; the inconsistency is from the docs' own example).

### `dlopen`'s `file:` handling is a string-prefix heuristic

what: Library path normalization tests `path?.startsWith?.("file:")` rather than parsing a URL or checking `instanceof URL` first.
where: `/workspace/bun/src/js/bun/ffi.ts:423-441` (`normalizePath`).
evidence: `ffi.ts:424`: `if (typeof path === "string" && path?.startsWith?.("file:")) { path = Bun.fileURLToPath(path); }` with the comment pointing at issue #10304 ("Support `file://…` for paths passed to `dlopen(…)`"). A relative on-disk path literally named `file:thing.so` (legal on POSIX) is misrouted to `fileURLToPath`.
why bad: Prefix heuristics over user-controlled paths is the bug class the repo's own review guide bans ("Use real parsers, never prefix-stripping or regex heuristics").
bun 2.0 proposal: Accept `string | URL | BunFile` and only run `fileURLToPath` on actual `URL` instances (or on `URL.canParse(path) && new URL(path).protocol === "file:"`).
blast radius: low.
confidence: medium.
