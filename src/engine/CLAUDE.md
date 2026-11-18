# The engine

JavaScript and WebAssembly execution for Bun, in Rust. Each folder here is a crate named `bun_engine_<folder>`; this folder itself is `bun_engine`, which assembles them.

## Crates, bottom up

| Crate                                           | Owns                                                                                               | `unsafe`     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------ |
| `text`                                          | `StringImpl`, atoms, symbols, `Text` views, `StringBuilder`, hashing                               | string core  |
| `unicode`, `number`, `bigint`, `date`           | character data; number ↔ text and numeric semantics; digit arithmetic; calendars, zones, date text | forbidden    |
| `regexp`, `regexp_jit`                          | pattern parser, compiler, backtracking interpreter; machine code for patterns                      | forbidden    |
| `syntax`                                        | lexer, parser, scope analysis, early errors                                                        | forbidden    |
| `bytecode`                                      | instruction set, generator, verifier, liveness, serialized form                                    | forbidden    |
| `asm`, `codegen`                                | assemblers and macro assembler; SSA IR down to machine code                                        | forbidden    |
| `wasm_format`, `wasm_compiler`                  | decoding and validation of modules; machine code for functions                                     | forbidden    |
| `exec_memory`                                   | executable pages, linking, patching                                                                | yes          |
| `platform`                                      | clocks, limits of the machine, stack bounds, suspending threads                                    | yes          |
| `wasm_runtime`                                  | linear memories, tables, instances, installing and tiering of code, faults                         | yes          |
| `macros`, `vm`                                  | heap and collector, object model, realms, calls, errors, modules, promises, caches, operations     | yes          |
| `interpreter`                                   | bytecode handlers and the stubs that enter, call and leave frames                                  | yes          |
| `builtins`, `intl`, `temporal`                  | the standard library                                                                               | forbidden    |
| `ffi`                                           | calls between scripts and native code whose signature is known only at run time                    | yes          |
| `baseline`, `optimizer`, `wasm`                 | compilers (safe code that produces bytes) and the code that installs and enters what they produce  | install only |
| `inspector`                                     | debugger, profilers, heap snapshots, protocol                                                      | sampling     |
| `embed`                                         | C ABI and C++ headers for Bun's bindings                                                           | yes          |
| `shell`, `standalone`                           | `engine-shell` and the native libraries it and the crates' tests link. Not part of Bun             |              |

A crate below `vm` knows nothing of the garbage collector: it is plain Rust over slices and owned data. A crate calls upwards only through a table of hooks that `bun_engine` fills in.

## Build and test

```sh
cargo build -p bun_engine_shell               # target/debug/engine-shell: optimized, with assertions
cargo build -p bun_engine_shell --release     # for measuring
cargo test -p bun_engine_regexp               # a test file names `bun_engine_standalone` to link the native libraries
cargo clippy -p bun_engine_<crate> --no-deps && cargo fmt -p bun_engine_<crate>
cargo check -p bun_engine_<crate> --target aarch64-apple-darwin   # and x86_64-pc-windows-msvc: `cfg`-gated code is not checked otherwise
```

## Rules

- **Safe by default.** A crate with `#![forbid(unsafe_code)]` keeps it. Elsewhere `unsafe` lives in small modules that export a safe interface whose types carry the invariant, and each block says why it holds.
- **Input never panics.** Scripts, patterns, modules, cached code and protocol messages are hostile. Sizes are checked or widened before arithmetic, an allocation whose size a script picks is fallible and ends in a thrown error, and recursion over input checks the stack. `panic!`, `unwrap` and indexing are for invariants of the engine.
- **Text is Latin-1 or UTF-16**, never UTF-8. Code over characters is generic over `CodeUnit` and entered through `with_text!`.
- **SIMD is highway**: a kernel in `src/jsc/bindings/highway_*.cpp` behind a safe wrapper in `src/highway`. No `std::simd`, no `core::arch`, and no Rust that is steered into vector instructions (lane masks, barriers, unrolled lanes); plain loops that the compiler vectorizes unaided are fine. For short inputs use `HWY_STATIC_DISPATCH`, which LTO inlines. Machine code that the compilers emit is not bound by this.
- **Compilers are pure.** A compiler reads a snapshot taken on the JavaScript thread and returns bytes and tables. It does not touch the heap, so it runs on any thread. What it assumed is checked again when the code is installed.
- **Data layout over pointers** in compilers and parsers: arenas and `u32` indices, no allocation per node.
- **Only what Bun uses.** No option, hook or function without a caller.
- **Comments** say what the code cannot, in a line. Cite the specification (ECMA-262, ECMA-402, WebAssembly, WHATWG, UAX) for what follows from it.

## Values and frames

A `Value` is 64 bits. Int32: `0xfffe_0000_xxxx_xxxx`. Double: its bits plus 2^49, NaN canonical. Cell: a pointer with the top 15 bits and bit 1 clear. `null` 0x02, `false` 0x06, `true` 0x07, `undefined` 0x0a. Zero is no value: `Option<Value>` is a slot that can be empty (a hole, a binding before its initialization), and `JsResult<Value>` is one register, zero when an exception is pending in the `Vm`.

Frames of every tier are on the native stack, chained through the frame pointer:

```
fp + 48 + 8n   argument n
fp + 40        this (new.target in a construct call)
fp + 32        argument count including this (low half), call site (high half)
fp + 24        callee
fp + 16        code block
fp +  8        return address
fp +  0        caller's fp
fp -  8(n+1)   local n
```

The caller builds the callee's header and arguments at the bottom of its own frame, in an even number of words that all belong to the callee, and restores the stack pointer after the call. It takes the code block and the entry from the `Executable` of the callee and passes that executable in `rcx` / `x9`; nothing links call sites to their targets. A callee entered with fewer arguments than parameters moves the frame down and pads it. No register survives a call between JavaScript functions except the pinned ones, so unwinding restores none:

| Pinned         | x86-64 | AArch64 |
| -------------- | ------ | ------- |
| frame pointer  | rbp    | x29     |
| `&Vm`          | r13    | x21     |
| number tag     | r14    | x22     |
| not-cell mask  | r15    | x23     |

Native functions and run-time operations use the C calling convention (System V on Windows too).

A profiler stops the thread at any instruction. A function of the engine that runs with the frame pointer at such a frame is `#[in_call_frame]`, generated code that makes frames as C does has `Owner::NATIVE`, and routines that generated code calls make theirs through `NativeFrames`.

## The heap

Cells do not move. The collector is generational mark and sweep, finds roots by scanning the native stack conservatively, and traces cells precisely. So a `Gc<T>`, a `Value` or a `&T` of a cell is safe in a local, an argument or a struct on the stack, and in a field of another cell. It is **never** put in memory of the Rust allocator (`Vec`, `Box`, `Rc`, `SmallVec`, a hash map, a boxed closure, a static). Instead:

| For                                   | Use                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------- |
| a list or map in a local              | `ValueVec`, `RootVec`, `RootMap`, `RootSet`, `RootDeque`, `RootBox`         |
| a field that changes                  | `Field<T>`, `FieldArray<T, N>`, `WeakField<T>`                              |
| a field that never changes            | the plain `Gc<T>` or `Value`                                                |
| a collection that a cell owns         | `TracedVec`, `TracedMap`, or `GcCell<T>` for any `T: Trace`                 |
| a reference from outside the heap     | `Strong`, `Weak`                                                            |
| state of the `Vm`                     | the `State` of the module, which is a `Service` and visits what it holds    |

The compiler checks neither this nor the anchors below. `bun run rust:rootcheck` does, in seconds (`tools/rootcheck/README.md`): run it before you commit.

What a function may do is in its signature:

| Parameter     | May                                                        |
| ------------- | ---------------------------------------------------------- |
| `&Vm`         | allocate, and so collect                                   |
| `&Cx`         | the same, in a realm, and throw. Derefs to `&Vm`           |
| `&mut Cx`     | also run scripts                                           |
| `&NoGc`       | none of these: `cx.no_gc()` borrows the `Cx` while it lives |

Memory that a cell owns outside itself is borrowed through a guard that keeps the cell alive (`StringView`, `ResolvedString`, `PropertyKey`, `GcRef`) or, if a script or an allocation can replace it, under `NoGc` (`elements`, `try_text`). What a plain accessor lends is held across an allocation only through an anchor: `symbol.anchor().name()`, `anchor!(self).info()`. A loop that calls out reads lengths and elements again on each turn.

## Cells and built-ins

`#[cell(..)]` declares a type of cell (see `CellKind`), `#[object_ops]` the internal methods that it overrides (see `ClassOps`; `Inherited` calls those of the base). An object that owns something with a destructor extends `JsDestructibleObject`. A type whose layout a tier or the embedder reads is in `vm` and has `OFFSET_OF_*` constants; the others are in the crate that uses them. Objects with internal fields that built-ins written in JavaScript read have a `FieldArray` right after the `JsObject`.

A native function is `#[native_abi] fn(&mut Cx, &CallFrame) -> JsResult<Value>`. Prototypes, constructors and namespaces list their properties in a `static_table!`, in the order in which they enumerate, and nothing is made before it is used: `builtins/fundamental/symbol.rs` has the pattern. What a realm has one of is a `RealmSlot`, and what a fast path assumes of the library is a `RealmWatchpoint`. A function that calls back for each element is written in JavaScript (`builtins/js`), where the compilers can inline the callback. Names are constants: add a line to `text/names.txt` and use `names::x`, `symbols::x` or `private_names::x`.
