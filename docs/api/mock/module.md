# `mock.module()`

The `mock.module()` function allows you to mock an entire module in Bun's test framework. This is useful when you want to replace a module's exports with mock implementations.

## Example

```typescript
import { test, expect, mock } from "bun:test";
import { foo } from "./some-module";

test("mock.module works", () => {
  // Original behavior
  expect(foo()).toBe("original");

  // Mock the module
  mock.module("./some-module", () => ({
    foo: () => "mocked"
  }));

  // Mocked behavior
  expect(foo()).toBe("mocked");
});
```

## Restoring mocked modules

When you use `mock.restore()` to restore a mocked module, it clears the mocked implementation but the imported module might still reference the mocked version. To fully restore the original module, you need to re-import it:

```typescript
import { test, expect, mock } from "bun:test";
import { foo } from "./some-module";

test("mock.restore works with mock.module", async () => {
  // Original behavior
  expect(foo()).toBe("original");

  // Mock the module
  mock.module("./some-module", () => ({
    foo: () => "mocked"
  }));

  // Mocked behavior
  expect(foo()).toBe("mocked");

  // Restore all mocks
  mock.restore();

  // Re-import the module to get the original behavior
  const module = await import("./some-module?timestamp=" + Date.now());
  const restoredFoo = module.foo;

  // Original behavior is restored
  expect(restoredFoo()).toBe("original");
});
```

The query parameter (`?timestamp=...`) is added to bypass the module cache, forcing a fresh import of the original module.

## API

### `mock.module(specifier: string, factory: () => Record<string, any>): void`

- `specifier`: The module specifier to mock. This can be a relative path, package name, or absolute path.
- `factory`: A function that returns an object with the mock exports. This object will replace the real exports of the module.

## Notes

- Mocked modules affect all imports of the module, even imports that occurred before the mock was set up.
- Use `mock.restore()` to clear all mocks, including mocked modules.
- You need to re-import the module after `mock.restore()` to get the original behavior.