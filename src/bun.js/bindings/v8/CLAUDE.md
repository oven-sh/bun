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
src/bun.js/bindings/v8/
├── v8.h                    # Main header with V8_UNIMPLEMENTED macro
├── v8_*.h                  # V8 compatibility headers
├── V8*.h                   # V8 class headers (Number, String, Object, etc.)
├── V8*.cpp                 # V8 class implementations
├── shim/                   # Internal implementation details
│   ├── Handle.h            # Handle and ObjectLayout implementation
│   ├── HandleScopeBuffer.h # Handle scope memory management
│   ├── TaggedPointer.h     # V8-style tagged pointer implementation
│   ├── Map.h               # V8 Map objects for inline function compatibility
│   ├── GlobalInternals.h   # V8 global state management
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

#### a. Add to `src/napi/napi.zig`

Find the `V8API` struct (around line 1801) and add entries for both GCC/Clang and MSVC:

```zig
const V8API = if (!bun.Environment.isWindows) struct {
    // ... existing functions ...
    pub extern fn _ZN2v88NewClass3NewEPNS_7IsolateE/* parameters */() *anyopaque;
    pub extern fn _ZNK2v88NewClass10SomeMethodEv() *anyopaque;
} else struct {
    // ... existing functions ...
    pub extern fn @"?New@NewClass@v8@@SA?AV?$Local@VNewClass@v8@@@2@PEAVIsolate@2@/* parameters */@Z"() *anyopaque;
    pub extern fn @"?SomeMethod@NewClass@v8@@QEBA/* return_type */XZ"() *anyopaque;
};
```

**To get the correct mangled names:**

For **GCC/Clang** (Unix):

```bash
# Build your changes first
bun bd --help  # This compiles your code

# Extract symbols
nm build/CMakeFiles/bun-debug.dir/src/bun.js/bindings/v8/V8NewClass.cpp.o | grep "T _ZN2v8"
```

For **MSVC** (Windows):

```powershell
# Use the provided PowerShell script in the comments:
dumpbin .\build\CMakeFiles\bun-debug.dir\src\bun.js\bindings\v8\V8NewClass.cpp.obj /symbols | where-object { $_.Contains(' v8::') } | foreach-object { (($_ -split "\|")[1] -split " ")[1] } | ForEach-Object { "extern fn @`"${_}`"() *anyopaque;" }
```

#### b. Add to Symbol Files

Add to `src/symbols.txt` (without leading underscore):

```
_ZN2v88NewClass3NewEPNS_7IsolateE...
_ZNK2v88NewClass10SomeMethodEv
```

Add to `src/symbols.dyn` (with leading underscore and semicolons):

```
{
    __ZN2v88NewClass3NewEPNS_7IsolateE...;
    __ZNK2v88NewClass10SomeMethodEv;
}
```

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

### JSC Integration

- Use `localToJSValue()` to convert V8 handles to JSC values
- Use `JSC::WriteBarrier` for heap-allocated references
- Implement `visitChildren()` for custom heap objects

### Tagged Pointers

- Small integers (±2^31) are stored directly as Smis
- Objects use pointer tagging with map pointers
- Doubles are stored in object layouts with special maps

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

**Symbol Not Found**: Ensure mangled names are correctly added to `napi.zig` and symbol files.

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
