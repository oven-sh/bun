# JavaScript Builtins in Bun

Write JS builtins for Bun's Node.js compatibility and APIs. Run `bun bd` after changes.

## Directory Structure

- `builtins/` - Individual functions (`*CodeGenerator(vm)` in C++)
- `node/` - Node.js modules (`node:fs`, `node:path`)
- `bun/` - Bun modules (`bun:ffi`, `bun:sqlite`)
- `thirdparty/` - NPM replacements (`ws`, `node-fetch`)
- `internal/` - Internal modules

## Writing Modules

Modules are NOT ES modules:

```typescript
const EventEmitter = require("node:events"); // String literals only
const { validateFunction } = require("internal/validators");

export default {
  myFunction() {
    if (!$isCallable(callback)) {
      throw $ERR_INVALID_ARG_TYPE("cb", "function", callback);
    }
  },
};
```

## Writing Builtin Functions

```typescript
// Fifo.ts
export function createFIFO<T>(): Dequeue<T> {
  const Dequeue = require("internal/fifo");
  return new Dequeue();
}
```

C++ access:

```cpp
object->putDirectBuiltinFunction(vm, globalObject, identifier,
  fifoCreateFIFOCodeGenerator(vm), 0);
```

## $ Globals and Special Syntax

**CRITICAL**: Use `.$call` and `.$apply`, never `.call` or `.apply`:

```typescript
// ✗ WRONG - User can tamper
callback.call(undefined, arg1);
fn.apply(undefined, args);

// ✓ CORRECT - Tamper-proof
callback.$call(undefined, arg1);
fn.$apply(undefined, args);

// $ prefix for private APIs
const arr = $Array.from(...);           // Private globals
map.$set(key, value);                   // Private methods
const newArr = $newArrayWithSize(5);    // JSC intrinsics
$debug("Module loaded:", name);         // Debug (stripped in release)
$assert(condition, "message");          // Assertions (stripped in release)
```

**Platform detection**: `process.platform` and `process.arch` are inlined and dead-code eliminated

## Validation and Errors

```typescript
const { validateFunction } = require("internal/validators");

function myAPI(callback) {
  if (!$isCallable(callback)) {
    throw $ERR_INVALID_ARG_TYPE("callback", "function", callback);
  }
}
```

## Build Process

`Source TS/JS → Preprocessor → Bundler → C++ Headers`

1. Assign numeric IDs (A-Z sorted)
2. Replace `$` with `__intrinsic__`, `require("x")` with `$requireId(n)`
3. Bundle, convert `export default` to `return`
4. Replace `__intrinsic__` with `@`, inline into C++

ModuleLoader.rs loads modules by numeric ID via `InternalModuleRegistry.cpp`.

## Key Rules

- Use `.$call`/`.$apply` not `.call`/`.apply`
- String literal `require()` only
- Export via `export default {}`
- Use JSC intrinsics for performance
- Run `bun bd` after changes
