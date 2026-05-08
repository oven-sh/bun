# Incrementally Rewriting Bun's Zig in Rust

## Why

Of the last 150 merged PRs to Bun, **108 are memory-safety-adjacent** — missed cleanup on an error path, use-after-free, uninitialized reads, out-of-bounds access, reentrancy. **75 of those would not compile** in a language with destructors, move semantics, and a borrow checker. One in three PRs we ship is "forgot to free something on an error path."

| Bug class                                        | Count (of 150) | Rust prevents?                                                      |
| ------------------------------------------------ | -------------- | ------------------------------------------------------------------- |
| Missing cleanup on error/early-return path       | 50             | yes — `Drop`                                                        |
| Use-after-free / stale pointer                   | 19             | yes — ownership/borrowck (6/8 of the aliasing kind)                 |
| Uninitialized / wrong-union-tag / type confusion | 6              | yes — no uninit, exhaustive `match`                                 |
| Bounds / integer overflow                        | 18             | downgraded — panic instead of UB                                    |
| Race / reentrancy                                | 15             | partial — borrowck catches mutate-while-iterate; not JS-side-effect |
| GC-rooting (JSC-specific)                        | 2              | no — needs API discipline                                           |
| Logic / spec / platform                          | 21             | no                                                                  |
| Infra / docs / refactor                          | 19             | n/a                                                                 |

Of the 108, ~88 are in Zig. The ~14 in C++ are mostly ref-cycles and GC-concurrency races — the residual class that survives any language. So the Zig→Rust delta is real: the Zig bugs are exactly the destructor/ownership-fixable kind, and the C++ side is already near the floor.

Without stronger compile-time guarantees, this stays a cat-and-mouse game. The proposal is to remove the largest bug class structurally rather than fix instances of it indefinitely.

## What

A strangler-fig migration of ~705K LOC of Zig to Rust, with both linked into the same binary throughout. The C++ JavaScriptCore-binding layer is unchanged; Rust replaces the Zig side of the same `extern "C"` seam, flipped per class via a flag in `.classes.ts`. No big-bang rewrite, no behavior change at any merge point, every flip gated on tests + shadow-diff + ≤2% perf microbench.

## Constraints

The same philosophy that made Bun fast stays:

- **Own the whole stack.** No `std::fs`, no `std::net` — `bun_sys` wraps raw syscalls with the same `FD`/errno/EINTR/Windows-path semantics Zig has today. No tokio, no async-std, no `Future` — just C callbacks on the uSockets loop and a verbatim port of Bun's `ThreadPool`. Very few external dependencies.
- **Zero perf regression.** Every flip is gated. Zig already pays an FFI `call` at every JSC boundary; parity means _don't add hops Zig doesn't have_, not "inline across languages."
- **Understand every layer.** Every type that crosses an FFI boundary has its `#[repr]` and layout asserted against the C/Zig definition at compile time.

## Why Rust and not C++

C++ has destructors and move semantics; it would solve the leak-on-error-path class (~36% of those 150 PRs). The remaining ~16-24% gap is borrow-checking (aliasing UAFs), no-uninitialized-reads, exhaustive `match`, and default-checked indexing — things C++ can do with discipline but does not enforce. For an autonomous agent fleet running continuously, "wrong code doesn't compile" is worth more than "wrong code triggers a sanitizer if a test covers it." Rust's clippy + custom dylint rules give mechanical PR gates that clang-tidy cannot match. See §19 for the full comparison.

A defensible alternative — port the JSC-touching runtime to C++ (where native `WTF::`/`JSC::` types eliminate FFI mirrors) and the JSC-free infrastructure to Rust — is noted in §19; this document pursues all-Rust.

## Scope of this document

Architecture, primitives, crate layout, build integration, and invariants. Per-API enumeration (every `.classes.ts` entry, every `node_*` binding) is **deferred to a follow-up document**; this one establishes where each kind of code goes and what rules it follows.

Every non-obvious factual claim below survived 3-vote adversarial verification against the source tree at the cited `file:line`. Rust design choices are stated with their `#[repr]` and calling convention.

---

## 1. Approach

Zig already speaks to JavaScriptCore through a C-ABI seam: `src/codegen/generate-classes.ts` and `src/codegen/cppbind.ts` emit `extern "C"` symbol names that the C++ JSCell wrapper layer calls. Rust slots into the **same seam** — `cargo build` produces `libbun_rs.a`, the build links it next to `bun-zig.o`, and per class an `impl: "zig" | "rust"` flag in `.classes.ts` decides which side defines a given symbol. The C++ wrapper layer (`ZigGeneratedClasses.{h,cpp}`) stays byte-identical regardless of which language implements `m_ctx`.

**No third-party async runtime.** Bun owns its async: the uSockets epoll/kqueue loop (vendored C, accessed via FFI) is the executor; native objects are state machines with C callbacks; cross-thread work goes through the ported `bun.ThreadPool` (kprotty/zap) and the dedicated `HTTPThread`. There is no `Future`, no `Waker`, no tokio/rayon/hyper/smol.

**No cross-language LTO requirement.** Zig already pays an FFI `call` for `Bun__WTFStringImpl__deref`, `*SetCachedValue`, `Foo__fromJS`, etc. (`src/string/wtf.zig:89-107`, `generate-classes.ts:2121-2144`). Parity means **don't add hops Zig doesn't have**, not "inline across languages." Linker-plugin LTO (`-Clinker-plugin-lto`) is a follow-up once `rust-toolchain.toml` pins to an LLVM matching `LLVM_VERSION = "21.1.8"` (`scripts/build/tools.ts:267-270`).

---

## 2. JSC Garbage Collector — The Model Everything Depends On

Riptide is **non-moving, generational, mostly-concurrent mark-sweep**, conservative on the native stack and precise on the heap.

| Property                                            | Consequence                                                                                                                                                                                                                  | Source                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Non-moving**                                      | A `JSCell*` (and any `EncodedJSValue` boxing one) is address-stable for the cell's lifetime. No `Pin`, no relocation handles.                                                                                                | `MarkedBlock.h`; `ConservativeRoots.cpp:99-140`                        |
| **Conservative stack scan**                         | Any `JSValue` in a Rust local is rooted automatically. `ensure_still_alive(v)` = `core::hint::black_box(v)` keeps it on the stack past last use.                                                                             | `JSValue.zig:2244-2248`; `ConservativeRoots.cpp` (`genericAddPointer`) |
| **Precise heap**                                    | A `JSValue` field in a mimalloc-allocated native struct is **invisible** to the tracer. It is only safe if a §5 mechanism guarantees the cell is alive at every read.                                                        | `Heap.cpp:2970` (marking constraints)                                  |
| **Generational (Eden/Full)**                        | Heap-to-heap edges go through `WriteBarrier::set`, which records the owner in the remembered set. Storing into a JSCell field without the barrier means an Eden GC frees a young value while an old cell still points at it. | `WriteBarrier.h`; `generate-classes.ts:1025-1042`                      |
| **Concurrent marking**                              | `visitChildren`/`visitAdditionalChildren` run on GC threads **while the mutator runs**. They may only read `WriteBarrier<>` fields — no `RefCounted::ref/deref`, no `WeakPtr` creation, no allocation.                       | `Heap.cpp` (`DOMGCOutputConstraint` registered `Concurrent, Parallel`) |
| **`isReachableFromOpaqueRoots` runs on GC threads** | `hasPendingActivity` is called from `WeakBlock::visit()` during the `Ws` constraint with `ConstraintParallelism::Parallel`. Side-effect-free; single atomic load.                                                            | `WeakBlock.cpp:129`; `Heap.cpp:3104-3111`                              |
| **`JSC::Strong` is a root, not a traced edge**      | A `Strong` from native to a JS object that references the wrapper back is an uncollectable cycle. `Strong` is for **bounded-lifetime** holds with an explicit release point only.                                            | `Heap.cpp:3053-3056` (`Sh` constraint visits HandleSet)                |

### 2.1 Marking constraint roots (`Heap::addCoreConstraints`, `Heap.cpp:2970`)

| Tag    | What it scans                                                                               | Rust relevance                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cs`   | Conservative stack/registers                                                                | `JSValue` locals are auto-rooted; `black_box` is the only API needed                                                                       |
| `Msr`  | `m_protectedValues` (gcProtect), `MarkedArgumentBuffer` mark-list, smallStrings, exceptions | `protect()` is legacy; `MarkedArgumentBuffer` is the only safe heap-array-of-JSValue                                                       |
| `Sh`   | Strong handles (`HandleSet`)                                                                | `bun_jsc::Strong` allocates one slot here per `upgrade()`                                                                                  |
| `Ws`   | Weak sets → `WeakHandleOwner::isReachableFromOpaqueRoots`                                   | `hasPendingActivity` callback site                                                                                                         |
| `O`    | `visitOutputConstraints` fixpoint                                                           | **No generated class enrolls here** (`generate-classes.ts:1618-1643`); Rust must preserve this                                             |
| `Domo` | Bun's `DOMGCOutputConstraint` over `m_outputConstraintSpaces`                               | Membership decided by runtime fn-pointer compare `T::visitOutputConstraints != JSCell::visitOutputConstraints` (`BunClientData.h:193-196`) |

### 2.2 `reportExtraMemory` pairing

Two paths exist (`generate-classes.ts:699-759, 1653-1657`; `bindings.cpp:4852`):

- **Unpaired legacy:** `JSC__VM__reportExtraMemory` → `heap.deprecatedReportExtraMemory(size)`. For transient buffers.
- **Paired (when `.classes.ts` has `estimatedSize: true`):** constructor calls `reportExtraMemoryAllocated` (a GC safepoint) AND generated `visitChildren` calls `reportExtraMemoryVisited`. Forgetting the visit-side half causes the GC death-spiral.

The Rust `define_js_class!` macro enforces pairing at compile time — `estimatedSize: true` implies both halves.

---

## 3. Binding Codegen Contract

`generate-classes.ts` emits, per `.classes.ts` definition:

```
┌────────────────────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────┐
│ C++ JSCell wrapper (generated)         │    │  C-ABI extern fns        │    │  Native struct   │
│  JSFoo : JSDestructibleObject          │────│  FooClass__construct     │────│  *Foo (m_ctx)    │
│   void* m_ctx                          │    │  FooPrototype__bar       │    │  on mimalloc     │
│   WriteBarrier<Unknown> m_x ...        │    │  FooClass__finalize      │    │  heap            │
│   Weak<JSFoo> m_weakThis (optional)    │    │  Foo__hasPendingActivity │    │                  │
│   visitChildren / IsoSubspace / DOMJIT │    │  Foo__estimatedSize      │    │                  │
└────────────────────────────────────────┘    └──────────────────────────┘    └──────────────────┘
              STAYS C++                             Zig today → Rust              Zig today → Rust
```

The C++ side (`ZigGeneratedClasses.{h,cpp}`, IsoSubspaces, LazyStructure headers) is **unchanged** when a class flips to Rust. Gate: `sha256sum build/debug/codegen/ZigGeneratedClasses.cpp` is identical before/after flipping `lang` (`generate-classes.ts:3026-3037`).

### 3.1 Calling convention (`jsc_conv!`)

`jsc.conv` = SysV on **every** x64 target including Windows (`jsc.zig:9-12`; `PlatformCallingConventions.h:37-46`; `generate-classes.ts:2642-2647`). JSC's JIT emits SysV calls; a host fn with the Windows-x64 ABI corrupts the stack only when called from JIT'd code.

```rust
// bun_jsc::abi
#[cfg(all(windows, target_arch = "x86_64"))]
macro_rules! jsc_conv { () => { "sysv64" } }
#[cfg(not(all(windows, target_arch = "x86_64")))]
macro_rules! jsc_conv { () => { "C" } }
```

Every exported host function and every imported JSC extern uses `extern jsc_conv!()`. With `panic = "abort"` (workspace-wide), rustc emits `nounwind` and drops landing pads — no `extern "sysv64-unwind"` needed.

### 3.2 Symbols Rust **exports** per class

| `.classes.ts` field        | Symbol                      | Rust signature (`extern jsc_conv!()`)                                                              | Source                             |
| -------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `construct: true`          | `FooClass__construct`       | `fn(*mut JSGlobalObject, *mut CallFrame) -> *mut c_void` (null on exception)                       | `generate-classes.ts:410-421`      |
| `constructNeedsThis`       | + trailing `EncodedJSValue` |                                                                                                    | `:413`                             |
| `finalize: true`           | `FooClass__finalize`        | `fn(*mut c_void)`                                                                                  | `:440`                             |
| `proto.bar.fn`             | `FooPrototype__bar`         | `fn(*mut c_void, *mut JSGlobalObject, *mut CallFrame) -> i64`                                      | `:920-965`                         |
| `proto.bar.getter`         | `FooPrototype__getBar`      | `fn(*mut c_void, *mut JSGlobalObject) -> i64`                                                      | `:920-965`                         |
| `proto.bar.setter`         | `FooPrototype__setBar`      | `fn(*mut c_void, *mut JSGlobalObject, i64) -> bool`                                                | `:920-965`                         |
| `klass.bar.fn` (static)    | `FooClass__bar`             | `fn(*mut JSGlobalObject, *mut CallFrame) -> i64` (raw `JSC_DECLARE_HOST_FUNCTION`, no `void* ptr`) | `:996-1020`                        |
| `klass.bar.getter`         | `FooClass__getBar`          | `fn(*mut JSGlobalObject, i64, PropertyName) -> i64` (3-arg `JSC_DECLARE_CUSTOM_GETTER`)            | `PlatformCallingConventions.h:145` |
| `klass.bar.setter`         | `FooClass__setBar`          | `fn(*mut JSGlobalObject, i64, i64, PropertyName) -> bool` (4-arg)                                  | `:146`                             |
| `hasPendingActivity: true` | `Foo__hasPendingActivity`   | `fn(*const c_void) -> bool` (GC-thread, side-effect-free)                                          | `:1684, 2180-2186`                 |
| `estimatedSize: true`      | `Foo__estimatedSize`        | `fn(*const c_void) -> usize`                                                                       | `:1381`                            |
| (always)                   | `Foo__ZigStructSize`        | `static: usize = size_of::<Foo>()` (note: `static`, not `const` — needs a symbol)                  | `:2152-2154, 1735-1755`            |

**Thunk body distinction (from refuted-claim correction):** proto methods route through `toJSHostCall` (opens `ExceptionValidationScope`, `@call(.auto)` user fn); class-static fns route through `toJSHostFn` (`host_fn.zig:16-22`, no `*this` receiver, no validation scope). The Rust emitter must generate distinct thunk bodies per kind.

### 3.3 Symbols Rust **imports** (already generated in C++)

| Purpose                                | Symbol                                                          | Source                     |
| -------------------------------------- | --------------------------------------------------------------- | -------------------------- |
| Wrap native ptr in JSCell              | `Foo__create(global, ptr) -> JSValue`                           | `generate-classes.ts:1905` |
| Unwrap                                 | `Foo__fromJS(JSValue) -> Option<NonNull<Foo>>`                  | `:1820-1860`               |
| Unwrap (no proto-walk)                 | `Foo__fromJSDirect(JSValue) -> Option<NonNull<Foo>>`            | `:1820-1860`               |
| Set traced field (fires write barrier) | `FooPrototype__xSetCachedValue(this_js, global, value)`         | `:1025-1042`               |
| Get traced field                       | `FooPrototype__xGetCachedValue(this_js) -> JSValue`             | `:1025-1042`               |
| Detach m_ctx                           | `Foo__dangerouslySetPtr(JSValue, Option<NonNull<Foo>>) -> bool` | `:1820-1860`               |
| Constructor object                     | `Foo__getConstructor(global) -> JSValue`                        | `:772`                     |

`Option<NonNull<T>>` is ABI-identical to Zig `?*T` / C `void*` via the guaranteed null-pointer niche.

### 3.4 Exception protocol

`bun.JSError = error{ JSError, OutOfMemory, JSTerminated }` (`bun.zig:155-163`). Contract enforced by `toJSHostCall`/`toJSHostFnResult` and asserted in debug by `ExceptionValidationScope`: `(return == 0) ⟺ vm.hasException()` (`host_fn.zig:31-68`).

```rust
pub enum JsError { Thrown, OutOfMemory, Terminated }
pub type JsResult<T> = Result<T, JsError>;

#[inline(always)]
fn host_call(g: *mut JSGlobalObject, f: impl FnOnce() -> JsResult<JSValue>) -> i64 {
    #[cfg(debug_assertions)] let _scope = ExceptionValidationScope::new(g);
    let ret = match f() {
        Ok(v) => v.0,
        Err(JsError::Thrown | JsError::Terminated) => 0,
        Err(JsError::OutOfMemory) => unsafe { JSGlobalObject__throwOutOfMemoryError(g); 0 },
    };
    #[cfg(debug_assertions)]
    debug_assert_eq!(ret == 0, unsafe { JSGlobalObject__hasException(g) });
    ret
}
```

### 3.5 `cppbind.ts` — the _other_ generator

`src/codegen/cppbind.ts` parses `[[ZIG_EXPORT(tag)]]` attributes on C++ functions (~119 of them) and emits per-tag wrappers (`cppbind.ts:400, 646-726`):

| Tag              | Rust thunk shape                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `nothrow`        | bare `pub fn x(...) -> CRet { unsafe { raw::JSC__X(...) } }`                                                                   |
| `zero_is_throw`  | `Result<JSValue, JsError>`, `if v.0 == 0 { Err } else { Ok(v) }`                                                               |
| `false_is_throw` | `Result<(), JsError>`, keyed on `!v`                                                                                           |
| `null_is_throw`  | `Result<NonNull<T>, JsError>`, keyed on `v.is_null()`                                                                          |
| `check_slow`     | `let r = raw::X(...); if raw::Bun__RETURN_IF_EXCEPTION(g) { Err } else { Ok(r) }` — **two** extern calls (`bindings.cpp:6214`) |

Extend `cppbind.ts` to emit `bun_jsc::sys` Rust alongside `cpp.zig` from the same parse — single source of truth.

### 3.6 DOMJIT

**Currently disabled in `.classes.ts` codegen** (`class-definitions.ts:294,302` strip it; `grep -c WithoutTypeChecks ZigGeneratedClasses.{cpp,zig}` == 0). However, **hand-written** DOMJIT exists outside the generator: `JSBuffer.cpp:2518-2600` (`jsBufferConstructorAlloc*WithoutTypeChecks` via `JSC_DEFINE_JIT_OPERATION`) and `FFIObject.zig` (Reader.{u8,i8,...}WithoutTypeChecks). The Rust port leaves these C++/Zig until last; the `nm | grep WithoutTypeChecks` count is **not** a parity invariant for `ZigGeneratedClasses` (it returns 19 from hand-written code).

### 3.7 Aliasing discipline for `m_ctx` thunks

Generated thunks pass `NonNull<Self>` (raw) into user impls; user methods take `this: NonNull<Self>` and dereference per-field. Mutable fields are `Cell<T>` / `UnsafeCell<T>` / `RefCell<T>` so **no `&mut Self` is ever formed across a call that can re-enter JS** — host functions are re-entrant; two live `&mut` to one `m_ctx` is UB (`generate-classes.ts:2423-2467` returns raw `?*T` with no exclusivity contract).

---

## 4. Core Types

### 4.1 `JSValue`

```rust
// bun_jsc::value
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct JSValue(pub i64);  // ABI = JSC::EncodedJSValue

impl JSValue {
    pub const UNDEFINED: Self = Self(0xa);
    pub const NULL: Self = Self(0x2);
    pub const FALSE: Self = Self(0x6);
    pub const ZERO: Self = Self(0);  // = "exception thrown"

    #[inline(always)]
    pub fn ensure_still_alive(self) {
        if self.is_cell() { core::hint::black_box(self.0); }
    }
}

// !Send + !Sync via PhantomData<*const ()> — JSValues are mutator-thread-only
```

`size_of == 8`, `Copy`, single register. No lifetime, no `Pin` (non-moving GC). Stack values are rooted by the conservative scanner. Heap storage requires a §5 mechanism. (`JSValue.zig:1-24, 2244-2248`)

### 4.2 `CallFrame` — **inline, zero-FFI** argument access

`CallFrame` is `opaque` but Zig hard-codes JSC's CallFrameSlot register layout and reads `arguments()`/`this()`/`callee()`/`argumentsCount()` via inline `@ptrCast` to `[*]const JSValue` + index — **zero extern calls** on the JS→native entry hot path (`CallFrame.zig:6-111`).

```rust
// bun_jsc::callframe — NOT routed through extern_
const OFFSET_CALLEE: usize = 3;
const OFFSET_ARGC_INCL_THIS: usize = 4;
const OFFSET_THIS: usize = 5;
const OFFSET_FIRST_ARG: usize = 6;

#[inline(always)]
fn as_registers(&self) -> *const JSValue { self as *const Self as *const JSValue }
```

`cargo asm CallFrame::arguments` must show **zero `call` instructions** — only `mov`/`lea` off `rdi` at fixed offsets. Any FFI hop here is a measurable regression on every JS→native call.

### 4.3 `WTF::StringImpl`

```rust
// bun_str::wtf
#[repr(C)]
pub struct WTFStringImpl {
    m_ref_count: AtomicU32,      // bit 0 = static-string; increment = 0x2; OPAQUE — never mutate from Rust
    m_length: u32,
    m_ptr: StringPtr,            // #[repr(C)] union { latin1: *const u8, utf16: *const u16 }
    m_hash_and_flags: UnsafeCell<u32>,  // bit 2 = is_8bit (S_HASH_FLAG_8BIT_BUFFER)
}
const _: () = assert!(size_of::<WTFStringImpl>() == 24);

#[repr(transparent)]
pub struct WTFString(NonNull<WTFStringImpl>);
```

`Clone`/`Drop` call `extern "C" Bun__WTFStringImpl__ref/deref` (`BunString.cpp:53-60`; `wtf.zig:89-107`). **Never** `fetch_add`/`fetch_sub` `m_ref_count` from Rust — `StringImpl::~StringImpl` dispatches on `bufferOwnership()` across 4 cases (`StringImpl.cpp:122-165`: BufferInternal/Owned/External/Substring) and unregisters from AtomString/Symbol registries; this destruction path is C++-only state. The static-flag fast-path check (`m_ref_count & 1`) before the FFI call is fine.

```rust
pub enum WTFSlice<'a> { Latin1(&'a [u8]), Utf16(&'a [u16]) }

impl WTFString {
    #[inline] pub fn as_slice(&self) -> WTFSlice<'_>;  // single load+mask, zero FFI
    /// Borrows when 8-bit ∧ all-ASCII; allocates otherwise. Returns &[u8] (WTF-8, not &str).
    pub fn to_utf8_in<'b>(&self, bump: &'b Bump) -> Cow<'b, [u8]>;
}
```

(`wtf.zig:56-88, 125-186`; `unicode.zig:371-377`)

### 4.4 `ZigString` and `BunString`

`ZigString.ptr` steals high bits: bit 63 = UTF-16, bit 62 = mimalloc-owned, bit 61 = UTF-8. `untagged()` truncates to **53 bits** (`ZigString.zig:629-632`). Use **strict provenance** (`ptr.map_addr(|a| a & PTR_MASK)`, stable 1.84) for miri-clean masking.

```rust
#[repr(C)] pub struct ZigString { ptr: *const u8, len: usize }  // tagged ptr, NOT &[u8]

#[repr(C)] pub union BunStringImpl { zig: ZigString, wtf: *mut WTFStringImpl }
#[repr(C)] pub struct BunString { tag: u8, impl_: BunStringImpl }
const _: () = assert!(size_of::<BunString>() == 24 && align_of::<BunString>() == 8);
// Dead=0, WTF=1, Zig=2, StaticZig=3, Empty=4
```

**Not a Rust enum.** `BunString__toWTFString` (`BunString.cpp:537-556`) writes `bunString->impl.wtf = ...; bunString->tag = ...;` independently in place — UB on a Rust enum reference. Store `tag` as raw `u8` (not `#[repr(u8)] enum` field) to tolerate unexpected bytes from C++. `Drop` calls `Bun__WTFStringImpl__deref` only when `tag == 1` (`headers-handwritten.h:481-491`).

### 4.5 SIMD string scans

`isAllASCII`, `indexOfChar`, `indexOfNewlineOrNonASCII`, `containsNewlineOrNonASCIIOrQuote`, `copyU16ToU8` etc. all FFI to existing C symbols `simdutf__validate_ascii` (double underscore, `bun-simdutf.cpp:26`) and `highway_*` (`highway.zig:1-65`, `highway_strings.cpp`). Declare identical `extern "C"` symbols in `bun_str::simd`; **do not** reimplement in `core::simd` (`portable_simd` is nightly-indefinite). `copyU16ToU8` input is `[*]align(1) const u16` — expose as `*const u16` (may be 1-byte aligned), not `&[u16]`.

---

## 5. GC Liveness Primitives — Decision Table

Six mechanisms exist in production. Each protects against a specific failure; none is interchangeable.

| #   | Primitive                                            | Protects against                           | Hazard                                                       | Rust type                                                                                                                                                                 | Consumers                                                                                                                  |
| --- | ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| 1   | `hasPendingActivity` + `AtomicU32`                   | Own wrapper freed while native I/O pending | None (no root cycle) — preferred for refcount-style liveness | `unsafe trait HasPendingActivity { unsafe fn has_pending_activity(this: *const Self) -> bool; }` (raw ptr — GC thread may alias mutator's `&mut`)                         | `PostgresSQLConnection`                                                                                                    |
| 2   | `JSRef {weak, strong, finalized}`                    | Own wrapper freed while active             | Leak if never `downgrade()`                                  | `enum JSRef { Weak(JSValue), Strong(OptionalStrong), Finalized }` — `.weak` is **bare** `JSValue`, NOT `JSC::Weak`; sound only because `finalize()` flips to `.finalized` | `Socket`, `Request`, `Response`, `ServerWebSocket`, `UDPSocket`, `Valkey`, `JSMySQLConnection`, `PostgresSQLQuery`, `Cron` |
| 3   | `Strong` / `OptionalStrong` (heap `JSC::HandleSlot`) | A _different_ JS object freed while held   | Uncollectable cycle if held indefinitely                     | `#[repr(transparent)] struct Strong(NonNull<DecodedJSValue>)`; `get()` is **zero-FFI** direct deref (`Strong.zig:123-127`)                                                | `NodeHTTPResponse.promise`, `RequestContext` stream refs                                                                   |
| 4   | `JSValue.protect`/`unprotect` (`gcProtect` table)    | JS object held by a non-wrapper native     | Same cycle hazard; manual pairing                            | `#[deprecated] unsafe fn protect/unprotect` — no RAII wrapper (would encourage use)                                                                                       | `RequestContext.response_jsvalue`, `Handlers` callbacks                                                                    |
| 5   | `Async.KeepAlive` / `jsc.Ref`                        | Process exits while I/O pending            | Not GC-related                                               | `#[repr(u8)] enum KeepAlive { Active=0, Inactive, Done }`; `struct ActiveTaskRef(Cell<bool>)` — both 1 byte, idempotent                                                   | Every async native (`poll_ref`)                                                                                            |
| 6   | `MarkedArgumentBuffer`                               | Heap `[JSValue]` freed during allocation   | —                                                            | `with_marked_args(                                                                                                                                                        | buf                                                                                                                        | ...)`scope-bound; lifetime`'a` prevents escape | `udp.sendMany`, YAML/Markdown parsers |

**Design rule:** prefer `.classes.ts` `values:` (→ `WriteBarrier<>` on the JSCell, traced, no cycle) over `Strong` in the native struct. `Strong`/`protect()` only with a documented bounded lifetime and explicit release site. The `#[derive(NativeClass)]` macro **rejects** any struct field of type `JSValue` with a compile error directing to `cache: true` in `.classes.ts`; opt-out via `#[guarded_by(has_pending_activity)]`.

(`JSRef.zig:90-202`; `Strong.zig:5-147`; `StrongRef.cpp:9-49`; `MarkedArgumentBuffer.zig:1-33`; `posix_event_loop.zig:5-112`; `jsc.zig:200-220`)

---

## 6. Object Lifetime Categories

Two **disjoint** categories with disjoint lifetime primitives:

### Category A — GC-wrapped (`.classes.ts` entry, `m_ctx` behind a JSCell)

Lifetime = GC finalizer calls `FooClass__finalize`. `JSRef`/`Strong`/`hasPendingActivity`/cached-values apply **here only**. Lives in `bun_runtime`.

### Category B — Pure native infrastructure

HTTP client state machine, `HTTPThread`, `AsyncHTTP`, `PackageManager`, `ThreadPool`, `BundleV2`, `LinkerContext`, `RequestContext`, lockfile. Lifetime = `Rc`/`Arc` / explicit ownership / pool / arena. **No `JSValue` fields, no `JSRef`, no GC.**

**Verified by grep:** `src/http.zig`, `src/http/AsyncHTTP.zig`, `src/http/HTTPThread.zig` have zero `JSRef`/`jsc.Strong`/`JSValue`/`hasPendingActivity` (`AsyncHTTP.zig:1-35`). `LinkerContext.zig` has zero GC-related `jsc.*`. `ThreadPool.zig` has zero (the only `jsc` ref is `wtf.releaseFastMallocFreeMemoryForThisThread` — bmalloc, not GC).

**However**, these directories DO have non-GC `jsc.*` namespace coupling that must be **relocated** before the layer boundary is real:

| Type currently under `jsc.*`                                                          | Moves to               | Why it's not actually JSC                                                             |
| ------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `jsc.ZigString.Slice`                                                                 | `bun_str`              | String view                                                                           |
| `jsc.AnyEventLoop` / `MiniEventLoop` / `EventLoopHandle` / `WorkPoolTask` / `AnyTask` | `bun_async`            | Loop/task primitives; `MiniEventLoop` already runs JS-free (`MiniEventLoop.zig:1-19`) |
| `jsc.CommonAbortReason`                                                               | `bun_core`             | Plain enum                                                                            |
| `jsc.API.ServerConfig.SSLConfig`                                                      | `bun_tls`              | Config struct                                                                         |
| `jsc.URL`                                                                             | `bun_url`              | Wraps WTF::URL                                                                        |
| `jsc.ModuleLoader.HardcodedModule.Alias`                                              | `bun_resolve_builtins` | Pure static `phf::Map` (zero `jsc.*` refs in `HardcodedModule.zig`)                   |
| `jsc.RegularExpression`                                                               | `bun_regex`            | Wraps Yarr (or use `regex` crate)                                                     |
| `jsc.API.BuildArtifact.OutputKind`                                                    | `bun_bundler`          | Plain enum                                                                            |
| `jsc.Node.uid_t/gid_t`                                                                | `bun_sys`              | typedefs                                                                              |
| `jsc.wtf.releaseFastMallocFreeMemoryForThisThread`                                    | `bun_async` (hook)     | bmalloc shim                                                                          |

After relocation, `*_core` crates are genuinely `bun_jsc`-free; `*_jsc` glue crates own every `toJS`/`fromJS`/host-function (`npm.zig:685-806`, `install_binding.zig`, `bundle_v2.zig:1928-2450` `JSBundleCompletionTask`, `Method.zig:151`, `H2Client.zig:44-46`, etc.).

**`RequestContext` is Category B** despite holding `JSValue` fields: it is NOT a `.classes.ts` wrapper (grep confirms 0 hits), pooled in `HiveArray(RequestContext, 2048)`, lifetime = manual `ref_count: u8` → pool-return (`RequestContext.zig:39, 59, 303-316`). It _borrows_ JS handles, releasing them in `finalizeWithoutDeinit` driven by refcount, not GC sweep.

**Bridge objects** (Category A holding Category B): `FetchTasklet` owns `*http.AsyncHTTP` (raw ptr, `allocator.create`) and surfaces results via `jsc.JSPromise.Strong`. AsyncHTTP never sees the promise; it calls back via `result_callback` with a plain `HTTPClientResult` (`FetchTasklet.zig:6,26,60,1085,1401`). This is the **only** place `bun_http` types and `jsc::Strong` coexist; dependency arrow is `bun_runtime → {bun_http, bun_jsc}`, never `bun_http → bun_jsc`.

---

## 7. `bun_sys` — Syscall Layer (NOT Rust std)

### Why not `std::fs`/`std::net`

| `bun.sys` invariant                                                                                                                                            | `std::io` would break it                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Linux: raw `syscall` instruction via `std.os.linux`; errno decoded from return register `(-4096, 0)` (`sys.zig:53-58`; `linux_errno.zig:227-249`)              | `std::io::Error::last_os_error()` reads TLS errno **unconditionally**; success path should be TLS-free |
| `Maybe<T> = Result<T, SysError>`; `SysError { errno: u16, syscall: Tag, fd, path: RawSlice, dest: RawSlice }` — zero-alloc on hot path (`sys/Error.zig:11-28`) | `io::Error` is the wrong shape; no syscall tag, no fd, no path                                         |
| `FD` = `packed struct(c_int)` on POSIX, `packed struct(u64)` on Windows with bit-63 = `kind: {system, uv}` (`fd.zig:1-35`)                                     | `RawFd`/`HANDLE` lose the tag; Windows dual-backend dispatch (`sys.zig:2129-2151`) needs it            |
| Per-OS `MAX_COUNT` clamp (Linux `0x7ffff000`, macOS `i32::MAX`, Windows `u32::MAX`) (`sys.zig:1800-1808`)                                                      | `std::io` doesn't clamp → EINVAL on large buffers                                                      |
| EINTR retry loop (linux/freebsd); macOS `$NOCANCEL` symbols (`sys.zig:1696-2127`)                                                                              | Different retry semantics                                                                              |
| Sentinel `[:0]const u8` paths → zero-copy to kernel (`sys.zig:1741-1781`)                                                                                      | `&Path` forces conversion; Windows forces UTF-16 alloc                                                 |
| Windows `normalizePathWindows` → `\??\` NT path into caller `[32768]u16` buffer from thread-local 4-buffer pool (`sys.zig:980-1069`)                           | No equivalent                                                                                          |

### Design

```rust
// bun_sys
pub type Maybe<T> = Result<T, SysError>;

#[repr(C)] pub struct SysError {
    pub errno: u16, pub syscall: Tag, pub fd: Fd,
    #[cfg(windows)] pub from_libuv: bool,
    pub path: RawSlice, pub dest: RawSlice,  // borrowed; .clone_owning() for escape
}

#[repr(transparent)] pub struct E(pub u16);  // non-exhaustive — NOT #[repr(u16)] enum (UB on unknown errno)

#[cfg(unix)]    #[repr(transparent)] pub struct Fd(libc::c_int);
#[cfg(windows)] #[repr(transparent)] pub struct Fd(u64);  // bit 63 = Kind::{System,Uv}

#[repr(u8)] pub enum Tag { Todo=0, Dup, Access, /* ~100 entries */ }
```

Backends: `bun_sys::linux` (raw syscalls via `linux-raw-sys` or `core::arch::asm!`, NOT `libc`); `bun_sys::darwin`/`freebsd` (`libc` crate); `bun_sys::windows` (`windows-sys` + `bun_uv_sys` FFI to vendored libuv). `cargo asm bun_sys::linux::read` must contain `syscall`, not `callq read@PLT`.

`Maybe`/`SysError` are **Rust-internal** (Zig's tagged union has no C ABI); cross-language edge during migration uses flat `#[repr(C)] SysErrorC { errno, syscall, fd, path_ptr, path_len, dest_ptr, dest_len }`.

---

## 8. Allocators & Containers

| Allocator                                                          | Used for                                                                                                                                                                          | Rust mapping                                                                                                                                                                                                                                                                   | Source                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `mimalloc` (global)                                                | Everything not below                                                                                                                                                              | `#[global_allocator] static A: bun_alloc::Mi` calling `extern "C" mi_malloc_aligned/mi_free` — **NOT** the `mimalloc` crate (would link a 2nd copy). Same heap as Zig's `bun.default_allocator` so cross-language ownership is `mi_free`-safe                                  | `bun.zig:14`; `allocators/basic.zig:10-71`; `mimalloc.ts` |
| `MimallocArena` (`mi_heap_t`)                                      | Bundler per-worker heaps; bundle-thread heap                                                                                                                                      | `bun_alloc::Arena(NonNull<mi_heap_t>)`; `Drop` = `mi_heap_destroy` (bulk-free, NOT `mi_heap_delete`). `ArenaRef<'a>` non-owning view = Zig `Borrowed`. Nightly `allocator_api` for `Vec::new_in`                                                                               | `MimallocArena.zig:42-162`                                |
| `NewStore`                                                         | AST nodes (`Expr.Data`, `Stmt.Data`)                                                                                                                                              | See §8.1                                                                                                                                                                                                                                                                       | `NewStore.zig`                                            |
| `ASTMemoryAllocator` (`StackFallback(8192)`)                       | Parser scratch                                                                                                                                                                    | `bumpalo::Bump` exposed through Zig-`Allocator`-vtable shim (built **on Zig side** — `std.mem.Allocator.VTable` is non-extern, `.auto` callconv)                                                                                                                               | `Allocator.zig:19-123`; §8.2                              |
| `HiveArray<T,N>.Fallback`                                          | RequestContext(2048), FilePoll(128), H2FrameParser(256), DNS PendingCache(32×15), PackageManager Task(64)/NetworkTask(128), HTTPContext PooledSocket(64), TranspilerJob(64), etc. | **Inline per-crate**, no shared crate. `struct Slab<T, const N: usize> { buf: Box<[MaybeUninit<T>; N]>, used: [u64; (N+63)/64] }`. `get()` = `trailing_zeros` (TZCNT). Boxed so addresses are stable (handed to C callbacks)                                                   | `hive_array.zig:4-142`                                    |
| `BabyList<T>` `{ptr, len:u32, cap:u32}` (16B)                      | AST `ExprNodeList`, `Part.List`, `ImportRecord.List`; bundler/css heavy                                                                                                           | **Crate-local** `ThinVec<T>` only on the 6 hot AST fields (`E.Array.items`, `E.Call.args`, `E.New.args`, `E.Object.properties`, `E.JSXElement.children`, `G.Decl.List`); `Vec<T>` (24B) everywhere else. Never crosses FFI by value (grep `bindings/*.{h,cpp}` = 0 `BabyList`) | `baby_list.zig:19-23`                                     |
| `MultiArrayList<T>` (SoA)                                          | `Graph.{input_files, ast}`, lockfile `Package.List`, router, Watcher                                                                                                              | Per-use-site `#[derive(StructOfArrays)]` or hand-written; no shared generic                                                                                                                                                                                                    | `multi_array_list.zig`                                    |
| `bun.ptr.RefCount` (intrusive u32)                                 | 57 sites across 48 files                                                                                                                                                          | **`Rc<T>` / `Arc<T>`** internally. C-stored pointers: `Arc::into_raw`/`from_raw`; repeated callbacks: `Arc::increment_strong_count`/`decrement_strong_count`. Transitional `extern "C" xxx_ref/xxx_deref` for handoff edges only — **zero hot-path callers**                   | `ref_count.zig:69-266`                                    |
| `bun.ptr.WeakPtr`                                                  | Only `RequestContext.request_weakref` → `Request`                                                                                                                                 | **NOT ported** — tech debt. Replace with `Rc<RequestInner>` + `Cell<bool> detached`                                                                                                                                                                                            | `weak_ptr.zig`; `Request.zig:43`                          |
| `TaggedPointerUnion` (`packed struct(u64) { _ptr:u49, data:u15 }`) | `Task` (~95 variants), `AnyRequestContext` (6), `ActiveSocket` (4)                                                                                                                | `#[repr(transparent)] struct(u64)` + macro-generated `match` jump-table; tags = `1024 - i`. Rust `enum` for internal-only cases                                                                                                                                                | `tagged_pointer.zig:1-71`                                 |

### 8.1 `NewStore` / `BlockStore` — the AST node allocator

`NewStore` is a `threadlocal` linked list of fixed `Block { [largest_size*count*2]u8, bytes_used, next }`; bump-within-block; `reset()` rewinds to first block **without freeing** (`NewStore.zig:33-115`). Exactly two instantiations: `Expr.Data.Store` (count=512) and `Stmt.Data.Store` (count=128) (`Expr.zig:3152`; `Stmt.zig:301`). `PreAlloc { metadata: Store, first_block: Block }` is one heap allocation; `firstBlock()` is `@fieldParentPtr` offset (`NewStore.zig:63-85`).

**Three coupled `pub threadlocal` vars** (`instance: ?*StoreType`, `memory_allocator: ?*ASTMemoryAllocator`, `disable_reset: bool`); `append()` checks `memory_allocator` first (bundler override path), else `instance.?.append` (`Expr.zig:3181-3230`). External writers: `ASTMemoryAllocator.push/pop`, `Macro.zig:41-44`, `bake.zig:714`, `npm.zig:1849`.

```rust
// bun_ast::store
#[repr(C)] struct Block<const SIZE: usize> { buf: [MaybeUninit<u8>; SIZE], used: u32, next: Option<NonNull<Block<SIZE>>> }
#[repr(C)] struct PreAlloc<const SIZE: usize> { metadata: BlockStore, first_block: Block<SIZE> }

#[thread_local] static EXPR_STORE: Cell<Option<NonNull<PreAlloc<EXPR_SIZE>>>>;
#[thread_local] static MEMORY_ALLOCATOR: Cell<Option<NonNull<AstMemoryAllocator>>>;
#[thread_local] static DISABLE_RESET: Cell<bool>;

#[repr(transparent)] #[derive(Copy, Clone)]
pub struct StoreRef<T>(NonNull<UnsafeCell<T>>);  // NO safe Deref/DerefMut — see below
```

**Why not `&'ast T`:** the visitor algorithm holds by-value `Expr` copies whose `StoreRef` aliases the same slot while recursing and mutating children (`visitExpr.zig:489,551,876,1025-1026,1196,1554`); a safe `&mut T` here is instant UB under Stacked Borrows. `StoreRef` exposes `fn ptr(self) -> *mut T` (always sound via `UnsafeCell::get`) and `unsafe fn as_mut<'a>(self) -> &'a mut T` with documented obligation. Threading `'ast` through ~40K LOC is the dominant port cost; Polonius (which would help) is nightly-indefinite.

**Migration:** keep `NewStore.zig` as-is until `js_parser`/`js_printer` callers move to Rust **in the same step**. The only acceptable FFI seam is at cold edges (`Bun__AstStore__{init,reset,deinit,growBlock}`); per-node `append()` stays a Zig `inline fn` against the `#[repr(C)]` Block fields. Do NOT expose `extern "C" append` — that adds an FFI hop per AST node (millions/file).

### 8.2 `Expr` / `Stmt` layout

```rust
#[derive(Clone, Copy)] #[repr(C)] pub struct Expr { pub loc: Loc, pub data: ExprData }
#[repr(transparent)] pub struct Loc(pub i32);

// repr(Rust), NOT repr(C,u8) — Zig union(Tag) has no C ABI; only SIZE parity matters
pub enum ExprData {
    Array(StoreRef<EArray>), Binary(StoreRef<EBinary>), Call(StoreRef<ECall>), /* ... boxed */
    Identifier(EIdentifier),  // inline: Ref(u64) + 3 bools — drives Data to 24B
    Number(f64), Boolean(bool), Missing, This, Null, Undefined, /* ... inline */
}
const _: () = assert!(size_of::<ExprData>() == 24 && size_of::<Expr>() == 32);
const _: () = assert!(size_of::<Stmt>() <= 24);
```

(`Expr.zig:2132-2192`; `Stmt.zig:257-297`; `E.zig:283-301`; `base.zig:97-112`)

### 8.3 `Ref` — 8-byte symbol handle

`Ref = packed struct(u64) { inner_index: u31, tag: enum(u2), source_index: u31 }`. Hashing is **Wyhash** over the 8 bytes (NOT identity — `source_index` is constant per file, identity-hash would cluster). Rust: `#[repr(transparent)] struct Ref(u64)` + `FxBuildHasher` or `wyhash`. (`base.zig:97-208`; `bun.zig:483-485`)

---

## 9. Event Loop & Threading — Own Async, No Runtime

### 9.1 `Task` is a `u64`, not a list node

JS-thread `Task` = `TaggedPointerUnion` over **~95 concrete types** (`Task.zig:4-99`). Dispatch in `tickQueueWithCount` is a giant `switch (task.tag())` → `runFromJS`/`runFromMainThread`. No vtable, no allocation per Task value.

```rust
#[repr(transparent)] pub struct Task(u64);
const ADDR_MASK: u64 = (1<<49)-1;
// bun_task_variants! macro emits #[repr(u16)] enum TaskTag (values 1024-i) + dispatch match
```

`tasks: RingBuf<Task>` (ported `LinearFifo`, NOT `VecDeque` — two-slice layout breaks the bulk-copy fast path). (`event_loop.zig:113, 308-355`)

### 9.2 `ConcurrentTask` — 16-byte intrusive MPSC node

`{ task: Task /*u64*/, next: PackedNextPtr /*usize, bit 0 = auto_delete*/ }`, compile-asserted 16B. `UnboundedQueue` = lock-free with `back`/`front` each on its own half-cache-line. Push = 1 `swap` + 1 `store`. (`ConcurrentTask.zig:13-73`; `unbounded_queue.zig`)

### 9.3 `KeepAlive` vs `ActiveTaskRef` (`jsc.Ref`)

**Distinct, non-refcounted, idempotent 1-byte toggles** gating two different counters:

- `KeepAlive` → `loop.{num_polls, active}` (uSockets blocking decision). Also `{ref,unref}Concurrently` (atomic on `vm.event_loop`) and `unrefOnNextTick` (atomic RMW on `vm.pending_unref_counter`).
- `ActiveTaskRef` → `vm.active_tasks` (process-exit decision).

Decoupled via `trait LoopHandle { fn ref_loop/unref_loop/add_active/sub_active/ref_concurrently/inc_pending_unref }`; `VirtualMachine` and `MiniEventLoop` both impl. (`posix_event_loop.zig:5-112`; `jsc.zig:200-220`; `Loop.zig:59-85`; `VirtualMachine.zig:46`)

### 9.4 `EventLoopTimer` — intrusive pairing-heap node

5 fields `{ next: timespec, state, tag (22 variants), heap: IntrusiveField{child,prev,next}, in_heap }`; `fire()` switches on tag and `@fieldParentPtr` recovers parent via **four** distinct field names (`timer`, `max_lifetime_timer`, `reconnect_timer`, `event_loop_timer`). Prerequisite: convert Zig side to `extern struct` + `enum(u8)` for ABI. (`EventLoopTimer.zig:1-224`; `io/heap.zig`)

### 9.5 `PosixLoop` overlays C `us_loop_t`

`extern struct { internal_loop_data align(16), num_polls:i32, ..., active:u32, pending_wakeups:u32, ready_polls:[1024]EventType }`. Zig reads/writes `num_polls`/`active` directly (no FFI) for ref/unref; `tick`/`wakeup`/`run` are `extern "C"` to usockets. **Rust never owns an epoll fd; it borrows usockets'.** Field offsets must match exactly — `static_assert(offsetof(us_loop_t, active)==N)` paired with Rust `offset_of!` assert. (`Loop.zig:1-131`)

### 9.6 `AutoFlusher`

1-byte `{ registered: bool }`; `DeferredTaskQueue = AutoArrayHashMapUnmanaged(?*anyopaque, *const fn(*anyopaque)->bool)`. Map key IS the object pointer; `run()` iterates by index, swap-removing entries whose callback returns false. Rust: `IndexMap<*mut (), unsafe fn(*mut ())->bool, FxBuildHasher>` with same swap-remove-during-iterate semantics. (`AutoFlusher.zig`; `DeferredTaskQueue.zig:29-60`)

### 9.7 `bun.ThreadPool` — port verbatim

kprotty's lock-free pool (`ThreadPool.zig:3-11`). `Sync = packed struct(u32) { idle:u14, spawned:u14, unused:bool, notified:bool, state:enum(u2) }` → `AtomicU32` with bit-shift accessors. `Task = { node: Node{next}, callback: *const fn(*Task) }` (intrusive, 2×usize). `Node.Buffer` = bounded SPMC ring `[256]Atomic(*Node)`; `Node.Queue` = Treiber stack with low-bit `HAS_CACHE|IS_CONSUMING` flags. `schedule()` fast path: 1 Relaxed load + 1 Relaxed fetch_add + 1 **Release cmpxchgWeak** loop (Treiber push — relaxed store is unsound) + 1 Release fetch_or. **Do NOT substitute crossbeam-deque or rayon.**

`WorkTask<C>` embeds BOTH a `PoolTask` AND a `ConcurrentTask` inline + `KeepAlive`; one round-trip = 1 heap alloc total. `container_of!` macro (memoffset-based) replaces `@fieldParentPtr`. (`ThreadPool.zig:33-1042`; `WorkTask.zig:14-76`)

**ABI precondition:** Zig `Task.callback` is currently default callconv; before cross-language enqueue, change to `callconv(.C)` (mechanical pass).

---

## 10. HTTP Client — h1/h2/h3

### 10.1 Architecture

**One dedicated OS thread** (`HTTPThread`, `bun.once`-spawned, detached) owning a `jsc.MiniEventLoop` (uSockets, no JSC VM) running `processEvents() noreturn`. Process-static singleton `http_thread` holds two embedded `NewHTTPContext(false)/NewHTTPContext(true)` plus cross-thread queues. (`HTTPThread.zig:16-650`; `http.zig:6`)

| Layer                | Design                                                                                                                                                  | Source                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Cross-thread queue   | Intrusive MPSC `UnboundedQueue(AsyncHTTP, .next)`; `schedule(batch)` pushes + `loop.wakeup()`. Shutdown/write side-channels: `Mutex` + swap-and-drain   | `HTTPThread.zig:702-718`                        |
| Per-socket dispatch  | uSockets ext slot holds `TaggedPointerUnion(.{DeadSocket, HTTPClient, PooledSocket, H2.ClientSession})` — one u64. Callbacks dispatch on tag, no vtable | `HTTPContext.zig:60-121`                        |
| SSL monomorphization | `NewHTTPContext(comptime ssl: bool)` → two distinct types; entire send/receive path monomorphized. Rust: `HttpContext<S: SslMode>` sealed trait         | `HTTPContext.zig:1-105`; `http.zig:1587`        |
| Keep-alive pool      | `HiveArray(PooledSocket, 64)` per context; `PooledSocket` (auto-layout, NOT extern) inline `[128]u8 hostname_buf`                                       | `HTTPContext.zig:3-358, 615-712`                |
| Custom-TLS cache     | `AutoArrayHashMap(*SSLConfig, SslContextCacheEntry)`, max 60, 30-min TTL; intrusive `RefCount` so in-flight clients survive eviction                    | `HTTPThread.zig:6-358`; `HTTPContext.zig:74-82` |
| Body buffer reuse    | `StackFallback(32K)` for small; lazy singleton `[512K]u8 HeapRequestBodyBuffer` taken/returned via `Option::take`                                       | `HTTPThread.zig:46-162`                         |

### 10.2 h1 state machine

Two `HTTPStage` enums on `InternalState`. Response parsing via `picohttp.phr_parse_response` (FFI) writing into process-global `[256]picohttp.Header` scratch (safe — single thread). Chunked decode via `phr_decode_chunked` with inline `phr_chunked_decoder` per request. (`InternalState.zig:22-236`; `http.zig:33-37, 1871, 2655-2735`)

### 10.3 h2

`ClientSession` becomes the `ActiveSocket` variant after ALPN. Owns `*lshpack.HPACK` (FFI to vendored `lshpack.c`), `write_buffer: StreamBuffer`, `read_buffer`, `streams: AutoArrayHashMap(u31, *Stream)`. Hand-written framing in `h2_client/{dispatch,encode}.zig`. **Decoded headers feed the SAME `picohttp.Response`/`handleResponseBody` path as h1.** Coalescing: `active_h2_sessions` + `pending_h2_connects` lists checked before keep-alive pool. (`H2Client.zig`; `h2_client/ClientSession.zig:21-50`; `HTTPContext.zig:96-827`)

### 10.4 h3

One process-global `H3.ClientContext` lazily creates lsquic engine bound to HTTP thread's loop via C shim `packages/bun-usockets/src/quic.c`. `ClientSession` = one QUIC conn multiplexing `Stream`s 1:1 with `HTTPClient`s. Result delivery reuses `handleResponseMetadata`/`handleResponseBody`. **Keep the C shim; do NOT bind lsquic directly.** (`H3Client.zig`; `h3_client/ClientContext.zig:7-79`; `quic.c:36-78`)

### 10.5 `AsyncHTTP` handle

Caller-owned; embeds `HTTPClient` by value, intrusive `next`, `ThreadPool.Task`, `async_http_id: u32` (global atomic), `AtomicState`. Global atomics `active_requests_count`/`max_simultaneous_requests` (default 256, env `BUN_CONFIG_MAX_HTTP_REQUESTS`). On start, cloned into heap `ThreadlocalAsyncHTTP` so http-thread copy has stable address. (`AsyncHTTP.zig:1-92`; `HTTPThread.zig:510-601`)

---

## 11. `bun install`

### 11.1 PackageManager

Accumulates work into **five** `ThreadPool.Batch` fields on main thread: `task_batch` (CPU: parse/extract), `network_resolve_batch`, `network_tarball_batch`, `patch_apply_batch`, `patch_calc_hash_batch`. `scheduleTasks()` posts CPU batches to `manager.thread_pool`; merges tarball→resolve via O(1) `Batch.push`, posts to `HTTP.http_thread` (the **dedicated reactor thread**, NOT a worker pool). Preallocated `HiveArray(Task,64)` / `HiveArray(NetworkTask,128)`. (`PackageManager.zig:48-73, 1137-1138`; `runTasks.zig:1128-1157`)

### 11.2 Lockfile binary format

`Package` = `extern struct { name, name_hash, resolution, dependencies, resolutions, meta, bin, scripts }` stored in `MultiArrayList(Package)` (SoA, single slab). All variable-length data via `ExternalSlice<T> { off:u32, len:u32 }` (8B) into 6 flat `Buffers` arrays. `Semver.String` = 8B `[8]u8` (inline ≤8 / external `{off:u32,len:u32}` via bit 63 of u64 bitcast). `bun.lockb` is **NOT mmapped** — `readToEnd` into heap, then per-section `bytemuck::pod_collect_to_vec` (NOT `try_cast_slice` — `Vec<u8>` align 1). Dependencies undergo per-element `parseWithTag` re-parse (NOT zero-copy). (`Package.zig:1-2227`; `ExternalSlice.zig`; `SemverString.zig`; `Buffers.zig:79-355`; `bun.lockb.zig`)

### 11.3 Streaming tarball extraction

`NetworkTask.tarball_stream: ?*TarballStream` — Mutex-guarded double-buffer (NOT lock-free ring). `notify()` (HTTP thread) on first 2xx chunk ≥ `minSize()`: commits, `onChunk(chunk, false)`, `response_buffer.reset()`. `onChunk` locks, `pending.appendSlice`, schedules `drain_task` on `thread_pool` (guarded by `draining: AtomicBool`). Worker swaps `pending`↔`reading` under mutex; libarchive's pull-based read callback hands out `reading.items[read_pos..]` lock-free. `tarball_stream` is `Option<NonNull<_>>`, NOT `Box` (back-pointer + concurrent alias + self-free). (`NetworkTask.zig:28-358`; `TarballStream.zig:27-816`)

### 11.4 Extraction

`ExtractTarball.run()`: integrity verify → ISIZE peek (last 4B, cap 64MiB) → one-shot `libdeflate.gzip` else fallback `Zlib.ZlibReaderArrayList` (vendored C zlib, NOT miniz_oxide) → `Archiver.extractToDir`. Custom `readDataIntoFd` loops `archive_read_data_block` + `pwrite()` first (fallback `lseek+write`); on Linux, `fallocate` for entries >1MB. `BodyPool` = `ObjectPool(MutableString, init2048, threadsafe=true, 8)` — per-thread `threadlocal` freelist, no mutex. (`extract_tarball.zig:13-313`; `pool.zig:110-145`; `libarchive.zig:603-734`)

### 11.5 `*_core` / `*_jsc` split

`bun_install_core` (no `bun_jsc` dep): PackageManager, lockfile, dependency resolution. Relocate: `WorkPoolTask` → `bun_threadpool`, `URL.join` → `bun_url`, `PnpmMatcher` regex → `regex` crate, `AnyEventLoop` → `bun_async`. `bun_install_jsc`: every `JSValue`-touching fn (`jsParseLockfile`, `UpdateRequest::fromJS`, `npm::jsFunction*`, `security_scanner` w/ `jsc.Subprocess`/`Blob`). (`PackageManager.zig:106,872,1049`; `PnpmMatcher.zig:30`; `install_binding.zig`)

---

## 12. Bundler

### 12.1 Architecture

`BundleV2` owns `graph: Graph` and `linker: LinkerContext` by value. Bundle-thread arena = `ThreadLocalArena` (mimalloc heap) **passed into** `init`, stored at `graph.heap`; `BundleV2.allocator()` and `LinkerContext.allocator()` return the same heap. Separately, each `ThreadPool.Worker` owns its **own** `heap: ThreadLocalArena` — AST nodes allocated on per-worker heaps; cross-thread READS allowed, cross-thread ALLOCATION forbidden. (`bundle_v2.zig:11-30, 107-1007`; `Graph.zig:3-14`; `ThreadPool.zig:205-301`)

Rust: `BundleAlloc(NonNull<mi_heap_t>)` `Copy` raw handle (NOT `&'a Bump` — would force self-ref). `Graph { heap: MiHeap, pool: *mut ThreadPool, input_files: MultiArrayList<InputFile>, ast: MultiArrayList<BundledAst>, ... }`.

### 12.2 ParseTask flow

Per file: read → parse into `JSAst` using worker allocator → heap-alloc ONE `ParseTask.Result` via `bun.default_allocator` (NOT worker arena) → `enqueueTaskConcurrent` to bundle thread. Result freed on bundle thread; `JSAst` interior pointers still point into worker heap, moved by-value into `graph.ast`. `unsafe impl Send` for `BundledAst`. (`ParseTask.zig:13-1432`; `bundle_v2.zig:4149-4296`)

### 12.3 LinkerGraph clone

`LinkerGraph.ast` is a **shallow clone** of `Graph.ast` (NOT alias — comment is stale): `MultiArrayList.clone` allocates fresh column storage + memcpy. `module_scope.generated` and per-source `symbols` BabyLists deep-cloned onto linker allocator. Only inner BabyLists reached through shallow-copied columns (`parts`, `symbol_uses`) still point into worker heaps; appended-to with linker allocator (relies on mimalloc cross-heap realloc/free). (`bundle_v2.zig:1210-1232`; `LinkerGraph.zig:14-434`)

### 12.4 Scan-phase concurrency

`pending_items: u32` plain (NOT atomic — only mutated on bundle thread). Workers post to MPSC; `onParseTaskComplete` runs single-threaded under `thread_lock`, decrements, may enqueue more. (`Graph.zig:22-34`; `bundle_v2.zig:474-491, 4168-4175`)

### 12.5 `*_core` / `*_jsc` split + monomorphization

Six non-plugin JSC coupling points (`bundle_v2.zig:50, 1525, 2259, 2939, 3564, 5047, 5083`): hot-reloader cycle, `HardcodedModule.Alias` (per-import hot path → relocate to `bun_resolve_builtins` `phf::Map`), `NodeFS.writeFile`, `BuildArtifact.OutputKind`, `AnyEventLoop`, `Bun__setupLazyMetafile`. Invert via `trait BundleHost { type Watcher; fn setup_lazy_metafile(...); }`; `BundleV2<H: BundleHost>` monomorphized in `bun_runtime`, ships `NoHost` for CLI. `JSBundleCompletionTask` (`bundle_v2.zig:1928-2450`) → `bun_bundler_jsc`. `js_printer.zig:397` `RuntimeTranspilerCache` → `Option<&dyn TranspilerCache>` (cold).

`NewLexer_` (8 comptime bools), `NewPrinter` (5 comptime bools + `comptime Writer`) → `Lexer<const IS_JSON: bool, ...>`, `Printer<W: Write, const ASCII_ONLY: bool, ...>`. (`js_lexer.zig:58-90`; `js_printer.zig:599-606`)

---

## 13. Async-Native Rehearsal Ladder

Each step proves one new primitive on the smallest real consumer.

| Step | Target                                     | New primitives proven                                                                                                                                                                                                                                                                   | Why                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `Cron`                                     | `JSRef` lifecycle                                                                                                                                                                                                                                                                       | Smallest `JSRef` consumer, no I/O                                                                                                                                                                                                                        |
| 2    | `UDPSocket`                                | `KeepAlive`, uSockets FFI, `MarkedArgumentBuffer`                                                                                                                                                                                                                                       | Smallest socket native                                                                                                                                                                                                                                   |
| 3    | `NewSocket(ssl)` → `TCPSocket`/`TLSSocket` | `<const SSL: bool>` backing two `.classes.ts`; shared `Handlers` (9 `JSValue` callbacks `protect()`ed, `active_connections` count, `@fieldParentPtr` for server mode); intrusive `RefCount`; lazy-wrapper-on-first-callback; BoringSSL `ex_data`; `Rc::into_raw` for ext slot           | The template every async native copies (`socket.zig:49-1774`; `Handlers.zig:3-213`)                                                                                                                                                                      |
| 4    | `JSMySQLConnection` + protocol             | `EventLoopTimer`, `AutoFlusher`, protocol/binding split                                                                                                                                                                                                                                 | Already cleanly layered                                                                                                                                                                                                                                  |
| 5    | `PostgresSQLConnection`                    | `hasPendingActivity` atomic                                                                                                                                                                                                                                                             | After Zig refactor to MySQL's split                                                                                                                                                                                                                      |
| 6    | `Request`/`Response`/`Body`                | `Body.Value` state machine, `RefPtr<C++>` (FetchHeaders, AbortSignal), `BodyMixin` macro; **eliminate `request_weakref`**                                                                                                                                                               | Shared by serve and fetch                                                                                                                                                                                                                                |
| 7    | `ServerWebSocket`                          | (DOMJIT path when re-enabled)                                                                                                                                                                                                                                                           |                                                                                                                                                                                                                                                          |
| 8    | `NodeHTTPResponse`                         | `Strong` promise hold, dual `jsc.Ref`, socket-ext lookup, `uws.AnyResponse` runtime tag (cold path — node:http compat)                                                                                                                                                                  | (`NodeHTTPResponse.zig:5-56`)                                                                                                                                                                                                                            |
| 9    | `RequestContext` + `Server`                | `<const SSL,DEBUG,H3>` 6-way generic (`NewServer`: 4 instantiations × `has_h3=ssl_enabled` → 6); inline 2048-slot slab; `TaggedPointerUnion(u64)` `AnyRequestContext` (tags `1024-i`); `protect()` + `Strong` mix; `allocator` field caches `mi_heap_t*` to avoid `pthread_getspecific` | Hardest. `AnyRequestContext` is opaque u64 — Rust `Request`/`Response` interop with Zig `RequestContext` until this lands. **Port together with `Request`** or land bidirectional C-ABI accessors first (`Bun__AnyRequestContext__*`, `Bun__Request__*`) |

(`RequestContext.zig:21-2636`; `AnyRequestContext.zig:6-35`; `server.zig:513-2631`; `Request.zig:13-43`)

`SocketFlags` / `RequestFlags` = `#[repr(transparent)] struct(u16)` bitflags; debug-only field always reserved. (`socket.zig:1758-1774`; `RequestContext.zig:2597-2636`)

---

## 14. Rust Workspace Layout

```
crates/
├── Cargo.toml                  # workspace; [profile.release] panic="abort", codegen-units=1
│                               # [profile.dev] panic="abort"
├── bun-rs/                     # crate-type=["staticlib"] — re-exports all; #[global_allocator]
│
├── ── Layer 0 (no deps) ──────────────────────────────────────────────────────
├── bun_sys/                    # syscalls, FD, Maybe, E, Tag — raw libc/windows-sys/linux-raw-sys
├── bun_str/                    # WTFStringImpl, WTFString, WTFSlice, ZigString, BunString, simd FFI
├── bun_alloc/                  # GlobalAlloc impl over extern mi_*; Arena/ArenaRef over mi_heap_t
├── bun_core/                   # CommonAbortReason, etc.
├── bun_resolve_builtins/       # HardcodedModule.Alias as phf::Map
│
├── ── Layer 1 (MUST NOT depend on bun_jsc) ───────────────────────────────────
├── bun_threadpool/             # verbatim port of ThreadPool.zig; on_idle_timeout hook
├── bun_async/                  # PosixLoop FFI, KeepAlive, ActiveTaskRef, Task(u64), ConcurrentTask,
│                               #   UnboundedQueue, RingBuf, EventLoopTimer, AutoFlusher, DeferredTaskQueue,
│                               #   AnyEventLoop, MiniEventLoop, WorkTask
├── bun_url/ bun_tls/ bun_regex/ bun_semver/
├── bun_http/                   # HttpThread, HttpContext<S:SslMode>, AsyncHttp, h1/h2/h3
│   │                           #   pico/lshpack/lsquic FFI; HiveArray<PooledSocket,64> inline
│   └── (no bun_jsc dep — verified by grep)
├── bun_ast/                    # BlockStore, StoreRef, Expr/Stmt/Ref, ThinVec<T> (local)
│                               #   lexer/parser/printer; toml/yaml/json5
├── bun_install_core/           # PackageManager, lockfile, Semver.String, NetworkTask, TarballStream,
│                               #   extract; HiveArray<Task,64>/HiveArray<NetworkTask,128> inline
├── bun_bundler_core/           # BundleV2<H:BundleHost>, Graph, LinkerContext, ParseTask
├── bun_css/                    # lightningcss re-vendored + Bun diffs
│
├── ── Layer 2 (JSC boundary) ─────────────────────────────────────────────────
├── bun_jsc/                    # JSValue, CallFrame (inline!), JSRef, Strong/OptionalStrong,
│   │                           #   MarkedArgumentBuffer, host_call, JsResult, jsc_conv!,
│   │                           #   HasPendingActivity, EstimatedSize, NoRawJSValue
│   ├── sys.rs                  # PRIVATE — auto-gen extern jsc_conv!() decls from cppbind.ts
│   ├── raw.rs                  # 30 ZST opaque JSCell types; cast_unchecked
│   └── abi.rs                  # shared #[repr(C)] mirrors of headers-handwritten.h:
│                               #   ZigErrorType, Errorable<T>, ResolvedSource, SystemError,
│                               #   ZigStackFrame, ZigStackTrace, ZigException
│
├── ── Layer 3 (only place layer-1 meets bun_jsc) ─────────────────────────────
├── bun_runtime/
│   ├── generated/              # from generate-classes.ts Rust emitter — one mod per .classes.ts
│   │                           #   #[no_mangle] extern jsc_conv!() FooPrototype__bar thunks
│   ├── api/                    # Glob, Hash, Semver, ... Wave-A impls; bun:ffi (dlopen/TinyCC)
│   ├── socket.rs               # Socket<const SSL:bool>
│   ├── webcore/                # Request, Response, Body, Blob
│   ├── server/                 # LAST: RequestContext<const SSL,DEBUG,H3>; inline 2048-slab here
│   ├── fetch.rs                # FetchTasklet — bridge bun_http ↔ bun_jsc
│   └── node/                   # node_fs, node_net, ... binding impls
├── bun_install_jsc/            # jsParseLockfile, UpdateRequest::fromJS, npm::jsFunction*, security_scanner
├── bun_bundler_jsc/            # JSBundleCompletionTask, plugin host, hot-reloader
├── bun_http_jsc/               # Method.toJS, websocket_client JS glue, H2/H3 liveCounts
│
└── bun_panic/                  # set_hook → extern Bun__crashHandler
```

**Dependency invariant (CI):** `cargo tree -p bun_http -e normal | grep -q bun_jsc && exit 1` (likewise for `bun_install_core`, `bun_bundler_core`, `bun_threadpool`, `bun_async`, `bun_ast`). `cargo tree --invert bun_jsc` lists ONLY {`bun_runtime`, `bun_*_jsc`, `bun_shell`, `bun_sql`, `bun_valkey`, `bun_bake`, `bun_napi`}.

**`unsafe` placement:**

| Crate                                                                                                                                                                                                                   | `unsafe` policy                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bun_ast`, `bun_semver`, `bun_resolve_builtins`, `bun_core`                                                                                                                                                             | `#![forbid(unsafe_code)]`                                                                                      |
| `bun_sys`, `bun_str` (`wtf_ffi`/`simd`), `bun_alloc`, `bun_async::uws`, `bun_http` (pico/lshpack/quic FFI), `bun_install_core` (libarchive/libdeflate FFI), `bun_jsc::sys`/`raw`, `bun_runtime::generated`, `bun_panic` | allowed (FFI); `#![deny(unsafe_op_in_unsafe_fn)]`                                                              |
| Everything else                                                                                                                                                                                                         | `#![deny(unsafe_code)]` at crate root; per-module `#[allow(unsafe_code)]` only with `// UNSAFE-MODULE:` header |

**`!Send + !Sync` via `PhantomData<*const ()>`:** `JSValue`, `JSGlobalObject`, `CallFrame`, `Strong`, `JSRef`, `MarkedArgumentBuffer`, `VM`. (`VirtualMachine.zig:327-328`)

---

## 15. Build Integration

### 15.1 No CMakeLists.txt — TypeScript-generated Ninja

Register `crates/` as `scripts/build/deps/bun-rs.ts` returning `{ kind: "cargo", manifestDir: ".", libName: "bun_rs", source: { kind: "in-tree", path: "crates" } }` — follows the **lolhtml precedent** (`deps/lolhtml.ts`). `emitCargo()` pushes `<buildDir>/deps/bun-rs/<triple>/<profile>/libbun_rs.a` into `depLibs`, which `link()` already consumes (`bun.ts:466-472`).

Extend `EmitCargoInput` with `alwaysBuild?: boolean` (set for in-tree, mirroring `emitNestedCmake`'s `n.always()` pattern) and `extraImplicitInputs?: string[]` + `extraEnv` (for `BUN_CODEGEN_DIR`). `dep_cargo` rule has `restat=1` so cargo's own fingerprint prunes link when `.a` mtime unchanged. (`source.ts:585-605, 716-828, 1280-1418`)

### 15.2 CI split

Add `cfg.mode === "rs-only"` sibling of `zig-only`; per-target-OS agents (no Linux→darwin/msvc cargo cross precedent). `libbun_rs.a` is a **peer artifact** like `archive`/`zigObjects` — NOT in `allDeps` (would make every cpp-only agent redundantly cargo-build). `getLinkBunStep` `depends_on` includes `${key}-build-rs`. Runs concurrently with cpp-only/zig-only. (`.buildkite/ci.mjs:555-609`; `bun.ts:156-612`)

### 15.3 Codegen pipeline

Add 9th output `ZigGeneratedClasses.rs` to `emitGeneratedClasses` (`codegen.ts:567-598`); emit via `writeIfNotChanged` so `restat=1` prunes. One `pub mod <snake_type>` per class to avoid Rust E0428 collisions. Consumer crate `include!(concat!(env!("BUN_CODEGEN_DIR"), "/ZigGeneratedClasses.rs"))`.

### 15.4 Layout assertion harness

Add `b.addExecutable("emit-layouts")` in `build.zig` (precedent: `:563,634,771`) emitting `<codegenDir>/zig-layouts.json` with `@sizeOf`/`@alignOf`/`@offsetOf` for every `extern struct`. `crates/bun-ffi/build.rs` reads it, emits `OUT_DIR/layout_asserts.rs` with `const _: () = assert!(size_of::<T>() == N && offset_of!(T, f) == O);` for every `#[repr(C)]` mirror. All compile-time; zero binary bytes.

### 15.5 Allocator / panic

`bun_alloc::Mi` calls `extern "C" mi_malloc_aligned/mi_free/mi_realloc_aligned` — symbols resolve at final link against existing `static.c.o` (`mimalloc.ts`). Test: `assert!(mi_is_in_heap_region(Box::into_raw(Box::new(0u8)) as _))`. `bun_panic::install()` sets `panic::set_hook` → `extern "C" Bun__crashHandler` (`crash_handler.zig:2313`). `bun-rs.ts` mirrors lolhtml's rustflags: `-Cpanic=abort -Cforce-unwind-tables=no` (unix), `-Zbuild-std=std,panic_abort -Cpanic=immediate-abort` (release).

### 15.6 LTO (optional)

When `cfg.lto`: `rustflags.push("-Clinker-plugin-lto", "-Cembed-bitcode=yes", "-Ccodegen-units=1")`. Pin `rust-toolchain.toml` to nightly with LLVM major.minor matching `LLVM_VERSION_RANGE`; verify in `tools.ts` via `rustc -vV`. (`build.zig:214,827-832`; `flags.ts:398-731`; `zig.ts:39-48`)

---

## 16. Rust Rules & Lints

### 16.1 Language features (Rust 2024 edition)

| Feature                                                | Status             | Use                                                                      |
| ------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------ |
| `unsafe extern { safe fn ... }`                        | stable 1.82        | `bun_jsc::sys` marks pure getters `safe fn` → hundreds fewer `unsafe {}` |
| Strict provenance (`ptr.map_addr`)                     | stable 1.84        | `ZigString` bit-masking, `TaggedPointer` — miri-clean                    |
| `core::hint::assert_unchecked`                         | stable 1.81        | Replaces Zig `@setRuntimeSafety(false)` in lexer/parser hot loops        |
| `#[diagnostic::on_unimplemented]` / `do_not_recommend` | stable 1.78 / 1.85 | Custom errors on `NoRawJSValue`/`JsThreadOnly` marker traits             |
| `core::hint::unreachable_unchecked`                    | stable 1.27        | = `__builtin_unreachable`                                                |
| `#[cold]` on error fns                                 | stable             | Branch weight (no `likely`/`unlikely` — still nightly #151619)           |
| PGO (`cargo pgo`)                                      | tooling            | For pure branch-weight cases `#[cold]` doesn't cover                     |
| `extern "sysv64"`                                      | stable             | win-x64 only                                                             |
| Polonius / `allocator_api`                             | nightly-indefinite | `StoreRef<T>` and `bumpalo::collections` workarounds stand               |

### 16.2 `#[repr]` policy

| Category                                                 | `#[repr]`                                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Newtype over primitive crossing FFI / hot-loop signature | `#[repr(transparent)]` (`JSValue`, `Fd`, `Ref`, `Loc`, `TaggedPointer`, `IndexType`, `BabyString`)              |
| Mirror of C/Zig `extern struct`                          | `#[repr(C)]` + `const _: () = assert!(size_of/align_of/offset_of)` against `zig-layouts.json`                   |
| Mirror of C `union`                                      | `#[repr(C)] union`                                                                                              |
| Mirror of Zig `enum(uN)` (exhaustive, controlled)        | `#[repr(uN)] enum`                                                                                              |
| Mirror of Zig **non-exhaustive** enum or C++-written u8  | `#[repr(transparent)] struct T(uN)` + associated consts (avoids invalid-discriminant UB — `E`, `BunString.tag`) |
| Mirror of Zig `union(Tag)` (no C ABI)                    | `repr(Rust)` enum; only **size** parity matters                                                                 |
| Internal Rust types                                      | `repr(Rust)` (default)                                                                                          |

### 16.3 Clippy (`[workspace.lints]`)

```toml
[workspace.lints.rust]
unsafe_op_in_unsafe_fn = "deny"
improper_ctypes = "deny"
improper_ctypes_definitions = "deny"

[workspace.lints.clippy]
undocumented_unsafe_blocks = "deny"      # // SAFETY: required
cast_ptr_alignment = "deny"
transmute_ptr_to_ptr = "deny"
mem_forget = "deny"
redundant_clone = "deny"
unnecessary_to_owned = "deny"
needless_collect = "deny"
large_enum_variant = "warn"
unwrap_used = "warn"                     # deny in bun_runtime
expect_used = "warn"
panic = "warn"
todo = "deny"
unimplemented = "deny"
dbg_macro = "deny"
print_stdout = "deny"
too_many_arguments = "allow"
type_complexity = "allow"
```

### 16.4 Custom lints (dylint / build-time grep)

| Lint                            | Rule                                                                                                                               | Catches                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `jsc_conv_on_export`            | Every `#[no_mangle] extern fn` in `bun_runtime`/`bun_jsc` uses `extern jsc_conv!()`                                                | win-x64 JIT stack corruption      |
| `no_jsvalue_field`              | `JSValue` may not be a struct field outside `bun_jsc` internals; opt-out `#[guarded_by(has_pending_activity)]`                     | GC-invisible-heap class           |
| `no_borrow_across_js_call`      | `&[u8]`/`&str`/`WTFSlice` borrowed from a `JSValue` may not live across any call taking `&GlobalObject`                            | Getter side-effects detach buffer |
| `marked_args_for_jsvalue_slice` | `&[JSValue]`/`Vec<JSValue>` passed to anything that allocates → through `MarkedArgumentBuffer`                                     | Unrooted heap array               |
| `strong_bounded_by`             | Every `Strong`/`OptionalStrong` field has `/// bounded-by: <event>` doc                                                            | `Strong` leak                     |
| `extra_memory_paired`           | If a type calls `report_extra_memory_allocated`, its `.classes.ts` has `estimatedSize: true`                                       | GC death-spiral                   |
| `no_unwrap_jsresult`            | `.unwrap()`/`.expect()` forbidden on `JsResult<T>`                                                                                 | Swallowed exceptions              |
| `repr_on_boundary`              | Any type in an `extern` fn signature has `#[repr(C)]` or `#[repr(transparent)]`                                                    | Layout drift                      |
| `arc_from_raw_paired`           | `Arc::into_raw` has traceable `from_raw` in same module (or `// owned by:` comment)                                                | Leak                              |
| `keepalive_disable_on_drop`     | Types holding `KeepAlive` `disable()` it in `Drop`                                                                                 | Dangling event-loop ref           |
| `no_std_fs_net`                 | `std::fs::*`, `std::net::*`, `std::process::*` forbidden — use `bun_sys`                                                           | Consistent errno/FD               |
| `no_async_runtime`              | `tokio`, `async-std`, `smol`, `futures::executor`, `rayon`, `crossbeam`, `hyper`, `reqwest` forbidden in Cargo.toml (`cargo-deny`) | Own-async invariant               |
| `disallowed_types`              | `Box<dyn *>` banned in `bun_runtime`, `bun_http`, `bun_ast` hot paths                                                              | Monomorphize                      |

### 16.5 Const-generics policy

Where Zig uses `comptime bool`, Rust uses `const generics`; where Zig uses `comptime Type`, Rust uses generic + sealed trait. Runtime `enum Mode` permitted ONLY where Zig already pays the branch (e.g. `String.tag` switch, `uws.AnyResponse`).

### 16.6 Drop/Clone for FFI handles

| Type             | Clone                              | Drop                                    |
| ---------------- | ---------------------------------- | --------------------------------------- | ----------------------------------------- |
| `WTFString`      | `Bun__WTFStringImpl__ref`          | `Bun__WTFStringImpl__deref`             |
| `Strong`         | **NOT impl** (no clone FFI exists) | `Bun__StrongRef__delete`                |
| `OptionalStrong` | manual `set()` reuses slot         | `Bun__StrongRef__delete` if `Some`      |
| `BunString`      | `__ref` if `tag==WTF`              | `__deref` if `tag==WTF`                 |
| `Fd`             | `Copy`                             | **No Drop** — explicit `close()`        |
| `JSRef`          | **NOT impl**                       | **No Drop** (or debug-assert `Finalized | Weak(UNDEFINED)`) — finalize is GC-driven |
| `KeepAlive`      | `Copy`                             | No Drop (idempotent)                    |
| `Arena`          | NOT impl                           | `mi_heap_destroy`                       |

---

## 17. Zero-Regression Perf Invariants & Gates

### 17.1 Per-subsystem invariants

| Subsystem                  | Invariant                                                                                                         | Measure                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| JSC host call              | Thunk = tail-dispatch, no landing pad; `(ret==0)⟺hasException` debug-asserted                                     | `cargo asm` on a generated getter; `BUN_JSC_validateExceptionChecks=1` test suite |
| `JSValue`/`Strong`/`JSRef` | sizes 8/8/16; `Strong::get()` zero FFI; `JSRef` upgrade/downgrade = 1 FFI each                                    | static_assert; `cargo asm`; 10k connect/close `Bun__StrongRef__*` count == Zig    |
| `CallFrame`                | `arguments()`/`this()`/`callee()` zero `call` instructions                                                        | `cargo asm` diff vs Zig objdump                                                   |
| Strings                    | `is_8bit()`/`len()` ≤3 insns, zero FFI; `to_utf8` ASCII path 0 alloc; `BunString` Drop = `cmp;jne;jmp`            | `cargo asm`; heaptrack on `Bun.inspect` loop                                      |
| `bun_sys`                  | Linux `read` contains `syscall`, no PLT; success path zero TLS reads; `SysError` 0 alloc                          | `cargo asm`; heaptrack on `openSync("/nope")` loop                                |
| `Task` dispatch            | `size_of==8`; jump table not vtable                                                                               | `perf record` on 1M-timer; no `callq *0x8(%rax)`                                  |
| ThreadPool                 | `schedule()` 0 alloc; 4-op fast path; Task=2×usize                                                                | mimalloc stats diff; `objdump` fence count                                        |
| HTTP thread                | 1 OS thread; `processEvents` 0 alloc when queues empty; keep-alive pool 0 alloc ≤64; h2 coalesce → 1 TCP conn     | `getrusage` ctx-switches; integration test                                        |
| install                    | `scheduleTasks()` 0 alloc; lockfile load O(sections) memcpy; extract pwrite-dominant + fallocate                  | `hyperfine 'bun install'`; `strace -c` syscall mix                                |
| Bundler                    | `mi_free` count O(1) (heap-destroy only); per-node `append()` 0 FFI; `pending_items` non-atomic                   | `mi_stats_print`; `perf record` no `bun_runtime::` in CLI build                   |
| Serve                      | RequestContext 0 alloc ≤2048 concurrent; no `__tls_get_addr` in response path; `AnyRequestContext` 8B in register | `oha -z 30s` p50/p99; `perf record`                                               |

### 17.2 PR gates

1. `bun bd test <files>` passes with `BUN_RS_<Class>=1`
2. Same with `=0` (Zig path unbroken)
3. Shadow-diff: `BUN_RS_SHADOW=1` — pure functions assert `zig == rust`; objects structurally diffed
4. mitata p50 ≤ 2% vs Zig on auto-generated per-method microbench
5. `build.rs` layout asserts pass on Linux/macOS/Windows × x64/arm64
6. `cargo clippy --workspace -- -D warnings`
7. `cargo tree -p <layer-1-crate> | grep bun_jsc` empty
8. `nm libbun_rs.a | grep except_table` empty (unix)
9. `sha256sum ZigGeneratedClasses.cpp` unchanged
10. Reviewer lint pass (§16.4)

Nightly: full suite in three modes (all-Zig, all-Rust-where-ported, shadow-diff). Divergence auto-files `rust-port-regression`, flips `impl:` flag back.

---

## 18. Phase Plan & Timeline

### Throughput model

20 agents × 150 OTPS × 10× token→usable ratio over 705K LOC ≈ **~100h wall-clock**.

| Hours  | Track                                              | What lands                                                                                                                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 0–24   | **P0 critical path** (5 agents, 1 human reviewing) | `crates/` workspace + `bun-rs.ts` (lolhtml precedent); `bun_alloc`, `bun_panic`, `bun_sys`, `bun_str`, `bun_jsc` (incl. `sys`, `raw`, `abi`, `callframe`); layout-assert harness; `bun_threadpool`, `bun_async`                                                                                                                                   |
| 12–36  | **P1** (3 agents)                                  | `generate-classes.ts` Rust emitter (`ZigGeneratedClasses.rs` 9th output); `cppbind.ts` Rust emitter; `Glob` end-to-end through all 10 gates; shadow-mode (`BUN*RS*<Class>=0                                                                                                                                                                       | 1`) |
| 24–100 | **Fleet fan-out** (15+ agents, parallel tracks)    | Wave-A `.classes.ts` ∥ TOML/YAML/JSONC/MD parsers ∥ Ladder steps 1–5 (Cron→UDPSocket→Socket→MySQL→Postgres) ∥ relocate `jsc.*` namespace types (§6 table) ∥ `bun_http` + `bun_http_jsc` ∥ `bun_install_core` + `bun_install_jsc` ∥ CSS reverse-port ∥ `bun_ast` (lexer→parser→printer with `BlockStore`) ∥ `bun_bundler_core` + `bun_bundler_jsc` |
| 80–100 | **Human-paired**                                   | Ladder 6–9 (Request/Response → ServerWebSocket → NodeHTTPResponse → RequestContext+Server); macro-bench pass (`oha` serve, `bun install` 2000-dep, `bun build` three.js)                                                                                                                                                                          |

### Kill criteria (by hour 40)

- mitata gate trips on >30% of PRs → 10× ratio assumption wrong
- win-x64 sysv64 or layout-asserts fighting on day 2
- Human review is the bottleneck at 20 agents

### Deferred

| Item                                                                                     | Why                                            |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Per-API enumeration** (every `.classes.ts` proto method, every `node_*` binding shape) | → follow-up doc                                |
| `shell/` (22K, 180 comptimes)                                                            | Comptime-generated builtin dispatch; low churn |
| `bake/` (12K)                                                                            | Product surface still moving                   |
| Hand-written DOMJIT (`JSBuffer.cpp`, `FFIObject.zig`)                                    | Stays C++/Zig until last                       |
| `deps/` shims (uws, picohttp)                                                            | Keep as FFI                                    |

---

## 19. Why Rust Over C++

Analysis of the last 50 merged bugfix PRs (categorized by class):

| Class                               | Count | C++ (RAII+move+`unique_ptr`) solves | Rust solves                 |
| ----------------------------------- | ----- | ----------------------------------- | --------------------------- |
| Missing cleanup on error path       | 14    | 14                                  | 14                          |
| UAF / stale pointer                 | 8     | ~3 (ownership)                      | ~6 (+aliasing via borrowck) |
| Uninit / wrong-tag / type confusion | 4     | ~1                                  | 4                           |
| Bounds / overflow                   | 10    | ~0                                  | 10 (panic instead of UB)    |
| Logic / platform                    | 14    | 0                                   | 0                           |

**C++ ≈ 36%. Rust ≈ 52–60%.** Destructors alone buy ~65% of the Rust win. The remaining ~35% is borrowck (aliasing UAFs), no-uninit, exhaustive `match`, checked indexing.

C++ advantages: no third toolchain; native `WTF::`/`JSC::` types (no `#[repr(C)]` mirror tax); `generate-classes.ts` already emits C++ — could put `WriteBarrier<>` fields directly on impl class, eliminating `*SetCachedValue` FFI hop.

Rust advantages: borrowck-only bug class (≈5/50); bounds+uninit default-on (≈14/50); **mechanically lintable for a 20-agent autonomous fleet** — clippy + dylint + `#![forbid(unsafe_code)]` give compile-time gates clang-tidy can't match. For autonomous porting at scale, "wrong code doesn't compile" > "wrong code gets a sanitizer hit if the test covers it."

A defensible middle (not pursued here): port `bun.js/` runtime to **C++** (where native JSC types eliminate the mirror tax) and the JSC-free Layer 1 (`http`/`install`/`bundler`/`ast`/`threadpool`) to **Rust**. The crate-layer boundary in §14 is exactly where that split would be clean.

---

## Appendix A — Shared `#[repr(C)]` ABI catalog (`bun_jsc::abi`)

These cross the FFI **by value** today (`headers-handwritten.h:19-236`; `URL.zig:4-19` returns `BunString` by value via sret):

`ZigString`, `BunString`, `BunStringImpl`, `ZigErrorType`, `Errorable<T>` (`{ result: union{value,err}, success: bool }`), `ResolvedSource`, `SystemError`, `ZigStackFramePosition`, `ZigStackFrame`, `ZigStackTrace`, `ZigException`, `WTFStringImpl`.

`-D improper_ctypes_definitions` is the gate (compile-time fail on any FFI-unsafe signature).

## Appendix B — Constants

| Const                                 | Value                                 | Source                                  |
| ------------------------------------- | ------------------------------------- | --------------------------------------- |
| `MI_MAX_ALIGN_SIZE`                   | 16                                    | `mimalloc.zig:217`                      |
| `S_HASH_FLAG_8BIT_BUFFER`             | `1<<2`                                | `wtf.zig:21`                            |
| `S_REFCOUNT_INCREMENT` / `STATIC`     | `0x2` / `0x1`                         | `wtf.zig:25-28`                         |
| `ZigString` PTR_MASK                  | `(1<<53)-1`                           | `ZigString.zig:629-632`                 |
| `TaggedPointer` ADDR_MASK             | `(1<<49)-1`                           | `tagged_pointer.zig:1-7`                |
| Task tags                             | `1024 - i`                            | `tagged_pointer.zig:64-71`              |
| `MAX_KEEPALIVE_HOSTNAME`              | 128                                   | `HTTPContext.zig:129`                   |
| `LOCAL_INITIAL_WINDOW_SIZE` (h2)      | `1<<24`                               | `H2Client.zig:13`                       |
| `request_body_send_stack_buffer_size` | 32 KiB                                | `HTTPThread.zig:136`                    |
| `ssl_context_cache_max_size` / TTL    | 60 / 30 min                           | `HTTPThread.zig:6-14`                   |
| `ConcurrentTask` size                 | 16                                    | `ConcurrentTask.zig` (compile-asserted) |
| `Node.Buffer` capacity                | 256                                   | `ThreadPool.zig:850-860`                |
| `CallFrame` offsets                   | callee=3, argc=4, this=5, first_arg=6 | `CallFrame.zig:80-84`                   |
| `ExprData` / `Expr` / `Stmt` size     | 24 / 32 / ≤24                         | `Expr.zig:2191`; `Stmt.zig:296`         |
| `LLVM_VERSION`                        | 21.1.8                                | `tools.ts:267`                          |
