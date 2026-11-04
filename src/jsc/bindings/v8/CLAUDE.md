# V8 C++ API Implementation Guide

This directory contains Bun's implementation of the V8 C++ API on top of JavaScriptCore. This allows native Node.js modules that use V8 APIs to work with Bun.

## Architecture Overview

Bun implements V8 APIs by creating a compatibility layer that:

- Maps V8's `Local<T>` handles to JSC's `JSValue` system
- Uses handle scopes to manage memory lifetimes similar to V8
- Provides V8-compatible object layouts that inline V8 functions can read
- Manages tagged pointers for efficient value representation

For detailed background, see the blog series:

- [Part 1: Introduction and challenges](https://bun.com/blog/how-bun-supports-v8-apis-without-using-v8-part-1.md)
- [Part 2: Memory layout and object representation](https://bun.com/blog/how-bun-supports-v8-apis-without-using-v8-part-2.md)
- [Part 3: Garbage collection and primitives](https://bun.com/blog/how-bun-supports-v8-apis-without-using-v8-part-3.md)

## Directory Structure

```
src/jsc/bindings/v8/
├── v8.h                    # Main header with V8_UNIMPLEMENTED macro
├── v8_*.h                  # V8 compatibility headers
├── V8*.h                   # V8 class headers (Number, String, Object, etc.)
├── V8*.cpp                 # V8 class implementations
├── shim/                   # Internal implementation details
│   ├── Handle.h            # Handle and ObjectLayout implementation
│   ├── HandleScopeBuffer.h # The V8 handles of one handle scope (the scope itself is Bun::HandleScopeImpl, shared with Node-API)
│   ├── TaggedPointer.h     # V8-style tagged pointer implementation
│   ├── Map.h               # V8 Map objects for inline function compatibility
│   ├── GlobalInternals.h   # V8 global state management
│   ├── GlobalHandleRegistry.h # The handles of a VM's v8::Globals, strong and weak (see "Global Handles" below)
│   ├── InternalFieldObject.h # Objects with internal fields
│   └── Oddball.h           # Primitive values (undefined, null, true, false)
├── node.h                  # Node.js module registration compatibility
└── real_v8.h              # Includes real V8 headers when needed
```

## Implementing New V8 APIs

### 1. Create Header and Implementation Files

Create `V8NewClass.h`:

```cpp
#pragma once

#include "v8.h"
#include "V8Local.h"
#include "V8Isolate.h"

namespace v8 {

class NewClass : public Data {
public:
    BUN_EXPORT static Local<NewClass> New(Isolate* isolate, /* parameters */);
    BUN_EXPORT /* return_type */ SomeMethod() const;

    // Add other methods as needed
};

} // namespace v8
```

Create `V8NewClass.cpp`:

```cpp
#include "V8NewClass.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::NewClass)

namespace v8 {

Local<NewClass> NewClass::New(Isolate* isolate, /* parameters */)
{
    // Implementation - typically:
    // 1. Create JSC value
    // 2. Get current handle scope
    // 3. Create local handle
    return isolate->currentHandleScope()->createLocal<NewClass>(isolate->vm(), /* JSC value */);
}

/* return_type */ NewClass::SomeMethod() const
{
    // Implementation - typically:
    // 1. Convert this Local to JSValue via localToJSValue()
    // 2. Perform JSC operations
    // 3. Return converted result
    auto jsValue = localToJSValue();
    // ... JSC operations ...
    return /* result */;
}

} // namespace v8
```

### 2. Add Symbol Exports

For each new C++ method, you must add the mangled symbol names to multiple files:

#### a. Add to `src/runtime/napi/napi_body.rs`

Find the `v8_api` module and add entries to both the `#[cfg(not(windows))]` (Itanium) and `#[cfg(windows)]` (MSVC) `extern "C"` blocks:

```rust
#[cfg(not(windows))]
mod v8_api {
    use core::ffi::c_void;
    unsafe extern "C" {
        // ... existing functions ...
        pub(super) fn _ZN2v88NewClass3NewEPNS_7IsolateE/* parameters */() -> *mut c_void;
        pub(super) fn _ZNK2v88NewClass10SomeMethodEv() -> *mut c_void;
    }
}
#[cfg(windows)]
mod v8_api {
    use core::ffi::c_void;
    unsafe extern "C" {
        // ... existing functions ...
        #[link_name = "?New@NewClass@v8@@SA?AV?$Local@VNewClass@v8@@@2@PEAVIsolate@2@/* parameters */@Z"]
        pub(super) fn NewClass_New() -> *mut c_void;
        #[link_name = "?SomeMethod@NewClass@v8@@QEBA/* return_type */XZ"]
        pub(super) fn NewClass_SomeMethod() -> *mut c_void;
    }
}
```

**To get the correct mangled names:**

For **GCC/Clang** (Unix):

```bash
# Build your changes first
bun bd --help  # This compiles your code

# Extract symbols
nm build/CMakeFiles/bun-debug.dir/src/jsc/bindings/v8/V8NewClass.cpp.o | grep "T _ZN2v8"
```

For **MSVC** (Windows):

```powershell
# Use the provided PowerShell script in the comments:
dumpbin .\build\CMakeFiles\bun-debug.dir\src\jsc\bindings\v8\V8NewClass.cpp.obj /symbols | where-object { $_.Contains(' v8::') } | foreach-object { (($_ -split "\|")[1] -split " ")[1] } | ForEach-Object { "#[link_name = `"${_}`"] pub(super) fn ___() -> *mut c_void;" }
```

#### b. Add to Symbol Files

Add to `src/symbols.txt` (without leading underscore):

```
_ZN2v88NewClass3NewEPNS_7IsolateE...
_ZNK2v88NewClass10SomeMethodEv
```

Linux and FreeBSD need no entry: `src/linker.lds` exports `v8::*` and `node::*` by pattern.

**Note:** `src/symbols.def` is Windows-only and typically doesn't contain V8 symbols.

### 3. Add Tests

Create tests in `test/v8/v8-module/main.cpp`:

```cpp
void test_new_class_feature(const FunctionCallbackInfo<Value> &info) {
    Isolate* isolate = info.GetIsolate();

    // Test your new V8 API
    Local<NewClass> obj = NewClass::New(isolate, /* parameters */);
    auto result = obj->SomeMethod();

    // Print results for comparison with Node.js
    std::cout << "Result: " << result << std::endl;

    info.GetReturnValue().Set(Undefined(isolate));
}
```

Add the test to the registration section:

```cpp
void Init(Local<Object> exports, Local<Value> module, Local<Context> context) {
    // ... existing functions ...
    NODE_SET_METHOD(exports, "test_new_class_feature", test_new_class_feature);
}
```

Add test case to `test/v8/v8.test.ts`:

```typescript
describe("NewClass", () => {
  it("can use new feature", async () => {
    await checkSameOutput("test_new_class_feature", []);
  });
});
```

### 4. Handle Special Cases

#### Objects with Internal Fields

If implementing objects that need internal fields, extend `InternalFieldObject`:

```cpp
// In your .h file
class MyObject : public InternalFieldObject {
    // ... implementation
};
```

#### Primitive Values

For primitive values, ensure they work with the `Oddball` system in `shim/Oddball.h`.

#### Template Classes

For `ObjectTemplate` or `FunctionTemplate` implementations, see existing patterns in `V8ObjectTemplate.cpp` and `V8FunctionTemplate.cpp`.

## Memory Management Guidelines

### Handle Scopes

- All V8 values must be created within an active handle scope
- Use `isolate->currentHandleScope()->createLocal<T>()` to create handles
- Handle scopes automatically clean up when destroyed
- Node-API and the V8 API share one handle scope implementation, `Bun::HandleScopeImpl` (`src/jsc/bindings/napi_handle_scope.h`). `v8::HandleScope` and `Bun::NapiHandleScope` both open one, and `currentHandleScope()` returns the V8 handle storage of the innermost one, so V8 calls made from a Node-API callback work without any V8 scope of their own. Addons built against Node 26 headers never construct Bun's `v8::HandleScope` at all (it is inline); their scopes reach Bun only through `HandleScope::Extend` and `DeleteExtensions`.

### Global Handles

- A `v8::Global` (or `Persistent`) holds the address of a 32-byte `GlobalHandle`. The per-VM `v8::shim::GlobalHandleRegistry` (`shim/GlobalHandleRegistry.h`, owned by `JSVMClientData`) owns the handles, in 1024-byte blocks of 31 at addresses that are multiples of 1024. So `DisposeGlobal`, `MakeWeak` and `ClearWeak` find the block, and with it the VM and its thread, from the address of the handle alone.
- A `GlobalHandle` has the layout of a node of V8's GlobalHandles, because V8's inline code reads it: `IsWeak()` reads the state in the byte at 11 (Free 0, Normal 1, Weak 2, NearDeath 3), and `WrapperClassId()` and `SetWrapperClassId()` read and write the two bytes at 8. Word 0 is a Smi, or points at the `ObjectLayout` at 16, or at an Oddball.
- No realm owns a Global handle. A handle that holds a cell and is not weak has a strong root from `Bun__StrongRef__new` (`StrongRef.h`, what `bun_jsc::Strong` uses). So a Global keeps its value, and what the value references, until it is reset or its VM ends, also after the realm that made it is collected (`bun test --isolate`). The collector never reads a handle that is not weak.
- `Reset()` makes the handle Free. The handle is released (root deleted, handle cleared and put on the free list) once no realm of the VM has an open scope with V8 handles: V8's inline `Local::New(isolate, global)` copies the Global's word, so a `Local` points into the Global's handle. `HandleScopeBuffer::close()` calls `GlobalHandleRegistry::didCloseScope()` while disposed handles wait. So the value of a Global that is reset inside a native call stays until the scopes close, also if the Global was weak. V8 frees it at the next collection.
- Once the Bun VM is shutting down, no root is written or deleted, and no weak callback runs. The marking constraint then keeps the value of every handle alive.
- On a thread other than the VM's, `SetWeak()` and `ClearWeak()` do nothing, and `Reset()` and a move only set a bit of `GlobalHandle::offThread`. The thread of the VM reads the bits when the value of a weak handle dies: no callback runs for a Global that another thread reset, and nothing is written through the address of a Global without a callback that another thread moved.
- When the VM ends, `~GlobalHandleRegistry` frees every block that has no handle in use. A block with a Global that is still set is kept for the life of the process, with `registry` null: a later `Reset()` of that Global reads valid memory, and no later handle gets its address. Such a Global must not be read, as in V8.
- A Global of `undefined`, `null`, `true` or `false` has no cell: its handle holds the word that points at the root of the isolate, and that root is in the `GlobalInternals` of the realm.

#### Weak Global Handles

- `SetWeak()` empties the root of the handle (the root keeps its slot, so `ClearWeak()` allocates nothing) and adds the handle, with the callback and the parameter, to `m_youngWeak` of the registry. `ClearWeak()` writes the value back into the root. A weak handle of a number or an oddball never dies.
- A `Local` that was read from a weak Global must keep the value alive, as in V8. Such a `Local` is a raw slot that points into the Global's handle, which the scope does not visit. The "Srb" marking constraint of `JSVMClientData` calls `visitWeakHandlesOfOpenScopes()`, which reads the raw slots and the return-value slots of every open scope, and marks the cell of each weak handle that one of them points into. It runs only while the world is stopped.
- `HandleScope::Extend` and `HandleScope::CreateHandle` must not reach a collection, and have a `JSC::AssertNoGC`: V8's inline `Local::New(isolate, global)` reads the Global's word before the call and stores it in the slot after.
- `JSVMClientData::reconcileWeakReferencesAtGCEnd` calls `didFinishMarking()` at the end of each collection, with the world stopped and before anything is swept, possibly on the collector's thread. A weak handle whose cell is not marked becomes NearDeath: its callback, its parameter and (for `kInternalFields`) the first two aligned pointers of the object are copied, and the handle then reads as `undefined`. A handle that survives moves from `m_youngWeak` to `m_oldWeak`, and an eden collection reads only `m_youngWeak`.
- The first-pass callbacks run in the epilogue of that collection (a `JSC::GCCompletionCallback`), on the JS thread, before any other code of the mutator. If the collector's thread ended the collection (an idle collection, for which the JS thread gave up the heap), that is when the JS thread takes the heap again. This is V8's timing: an addon never sees a weak handle whose value is gone and whose callback has not run.
- `runFirstPasses()` holds a `JSC::CollectingScope`, so a first pass that allocates a JS cell ends the process, and so does one that asks for a collection. V8's contract allows only `Reset()` and `SetSecondPassCallback()` there. No Bun handle scope is opened for a first pass, because that allocates. A V8 call that needs a handle scope when none is open ends the process with a message that names the rule.
- A first-pass callback must reset its handle, or the process ends with V8's message. A callback still runs if another callback has reset its handle before.
- Second-pass callbacks run last first, with a handle scope open: from an event-loop task, or before `Isolate::LowMemoryNotification()` returns, or on exit before the cleanup hooks of the environment (`willRunCleanupHooks()`). No collection that JavaScript or Bun starts runs them (`Bun.gc(true)`, `gc()`, `bun:jsc`, `auto_garbage_collect`): those paths have no code for weak Globals. A second pass that collects does not start the second passes again.
- When `bun test --isolate` replaces the default realm, `didRetireDefaultRealm()` drops the weak state: each weak handle then reads as `undefined`, and no callback runs for it. A callback gets the `v8::Isolate` of the default realm, and an addon knows the isolate of the realm that made the Global.
- Each collection after which a first pass runs counts in the `v8_weak_callback` feature of crash reports.
- Differences from V8: JavaScript can run in a second pass (V8 prohibits it), and what it throws is reported as an uncaught exception. The second passes that are due do not run at the start of the next collection, and not before `gc()` returns: they wait for the event loop. The handle of a weak Global that its callback reset goes to the next Global. No weak callback runs once the VM is shutting down.

### JSC Integration

- Use `localToJSValue()` to convert V8 handles to JSC values
- Use `JSC::WriteBarrier` for heap-allocated references
- Implement `visitChildren()` for custom heap objects

### Tagged Pointers

- Small integers (±2^31) are stored directly as Smis
- Objects use pointer tagging with map pointers
- Doubles are stored in object layouts with special maps

### Environment Cleanup Hooks

- `node::AddEnvironmentCleanupHook` and `node::RemoveEnvironmentCleanupHook` (`node.cpp`) keep the hooks in `RareData::environment_cleanup_hooks` (`src/jsc/rare_data.rs`): a map of the VM from the pair of a function and its argument to the ordinal of its `Add`. A hook belongs to the VM of the thread that adds it. Neither function reads its isolate, which can be the one of a collected realm.
- `VirtualMachine::run_cleanup_hooks` runs the hooks in rounds, newest first, before the cleanup of each Node-API env of the round. It runs when a Worker exits in any way, and when the main thread ends without a requested exit (`exit_frees_environment`). Each hook gets a handle scope of the VM's current realm.
- `bun test --isolate` drops the hooks of a file when it replaces the global object.
- With the headers of Node 26.4 and later, each `node::ObjectWrap` adds one hook in its constructor and removes it in its destructor. The weak callback of a wrap whose object is collected deletes the wrap, which removes the hook. The hook deletes a wrap that is left when its environment ends.
- Differences from Node 26.12.1 that are left:
  - Node has one queue for these hooks and for `napi_add_env_cleanup_hook`.
  - Node aborts when a pair is added twice. Bun keeps the first one, because `bun --hot` and a second `process.dlopen` run an initializer again.
  - Node allows no JavaScript in a hook and seals its handle scope. Bun does neither for the V8 API.
  - Node stops the Workers of an environment before its hooks. Bun runs the hooks of a Worker first.
  - The overloads with an `AsyncCleanupHookHandle` and `node::AtExit` are not implemented.

## Testing Strategy

### Comprehensive Testing

The V8 test suite compares output between Node.js and Bun for the same C++ code:

1. **Install Phase**: Sets up identical module builds for Node.js and Bun
2. **Build Phase**: Compiles native modules using node-gyp
3. **Test Phase**: Runs identical C++ functions and compares output

### Test Categories

- **Primitives**: undefined, null, booleans, numbers, strings
- **Objects**: creation, property access, internal fields
- **Arrays**: creation, length, iteration, element access
- **Functions**: callbacks, templates, argument handling
- **Memory**: handle scopes, garbage collection, external data
- **Advanced**: templates, inheritance, error handling

### Adding New Tests

1. Add C++ test function to `test/v8/v8-module/main.cpp`
2. Register function in the module exports
3. Add test case to `test/v8/v8.test.ts` using `checkSameOutput()`
4. Run with: `bun bd test test/v8/v8.test.ts -t "your test name"`

## Debugging Tips

### Build and Test

```bash
# Build debug version (takes ~5 minutes)
bun bd --help

# Run V8 tests
bun bd test test/v8/v8.test.ts

# Run specific test
bun bd test test/v8/v8.test.ts -t "can create small integer"
```

### Common Issues

**Symbol Not Found**: Ensure mangled names are correctly added to `napi_body.rs` and symbol files.

**Segmentation Fault**: Usually indicates inline V8 functions are reading incorrect memory layouts. Check `Map` setup and `ObjectLayout` structure.

**GC Issues**: Objects being freed prematurely. Ensure proper `WriteBarrier` usage and `visitChildren()` implementation.

**Type Mismatches**: Use `v8_compatibility_assertions.h` macros to verify type layouts match V8 expectations.

### Debug Logging

Use `V8_UNIMPLEMENTED()` macro for functions not yet implemented:

```cpp
void MyClass::NotYetImplemented() {
    V8_UNIMPLEMENTED();
}
```

## Advanced Topics

### Inline Function Compatibility

Many V8 functions are inline and compiled into native modules. The memory layout must exactly match what these functions expect:

- Objects start with tagged pointer to `Map`
- Maps have instance type at offset 12
- Handle scopes store tagged pointers
- Primitive values at fixed global offsets

### Cross-Platform Considerations

- Symbol mangling differs between GCC/Clang and MSVC
- Handle calling conventions (JSC uses System V on Unix)
- Ensure `BUN_EXPORT` visibility on all public functions
- Test on all target platforms via CI

## Contributing

When contributing V8 API implementations:

1. **Follow existing patterns** in similar classes
2. **Add comprehensive tests** that compare with Node.js
3. **Update all symbol files** with correct mangled names
4. **Document any special behavior** or limitations

For questions about V8 API implementation, refer to the blog series linked above or examine existing implementations in this directory.
