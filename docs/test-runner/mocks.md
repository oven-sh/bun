Create mocks with the `mock` function.

```ts
import { test, expect, mock } from "bun:test";
const random = mock(() => Math.random());

test("random", async () => {
  const val = random();
  expect(val).toBeGreaterThan(0);
  expect(random).toHaveBeenCalled();
  expect(random).toHaveBeenCalledTimes(1);
});
```

{% callout %}
Alternatively, you can use the `jest.fn()` function, as in Jest. It behaves identically.

```ts
import { test, expect, jest } from "bun:test";
const random = jest.fn(() => Math.random());

test("random", async () => {
  const val = random();
  expect(val).toBeGreaterThan(0);
  expect(random).toHaveBeenCalled();
  expect(random).toHaveBeenCalledTimes(1);
});
```

{% /callout %}

The result of `mock()` is a new function that's been decorated with some additional properties.

```ts
import { mock } from "bun:test";
const random = mock((multiplier: number) => multiplier * Math.random());

random(2);
random(10);

random.mock.calls;
// [[ 2 ], [ 10 ]]

random.mock.results;
//  [
//    { type: "return", value: 0.6533907460954099 },
//    { type: "return", value: 0.6452713933037312 }
//  ]
```

The following properties and methods are implemented on mock functions.

- [x] [mockFn.getMockName()](https://jestjs.io/docs/mock-function-api#mockfngetmockname)
- [x] [mockFn.mock.calls](https://jestjs.io/docs/mock-function-api#mockfnmockcalls)
- [x] [mockFn.mock.results](https://jestjs.io/docs/mock-function-api#mockfnmockresults)
- [x] [mockFn.mock.instances](https://jestjs.io/docs/mock-function-api#mockfnmockinstances)
- [x] [mockFn.mock.contexts](https://jestjs.io/docs/mock-function-api#mockfnmockcontexts)
- [x] [mockFn.mock.lastCall](https://jestjs.io/docs/mock-function-api#mockfnmocklastcall)
- [x] [mockFn.mockClear()](https://jestjs.io/docs/mock-function-api#mockfnmockclear)
- [x] [mockFn.mockReset()](https://jestjs.io/docs/mock-function-api#mockfnmockreset)
- [x] [mockFn.mockRestore()](https://jestjs.io/docs/mock-function-api#mockfnmockrestore)
- [x] [mockFn.mockImplementation(fn)](https://jestjs.io/docs/mock-function-api#mockfnmockimplementationfn)
- [x] [mockFn.mockImplementationOnce(fn)](https://jestjs.io/docs/mock-function-api#mockfnmockimplementationoncefn)
- [x] [mockFn.mockName(name)](https://jestjs.io/docs/mock-function-api#mockfnmocknamename)
- [x] [mockFn.mockReturnThis()](https://jestjs.io/docs/mock-function-api#mockfnmockreturnthis)
- [x] [mockFn.mockReturnValue(value)](https://jestjs.io/docs/mock-function-api#mockfnmockreturnvaluevalue)
- [x] [mockFn.mockReturnValueOnce(value)](https://jestjs.io/docs/mock-function-api#mockfnmockreturnvalueoncevalue)
- [x] [mockFn.mockResolvedValue(value)](https://jestjs.io/docs/mock-function-api#mockfnmockresolvedvaluevalue)
- [x] [mockFn.mockResolvedValueOnce(value)](https://jestjs.io/docs/mock-function-api#mockfnmockresolvedvalueoncevalue)
- [x] [mockFn.mockRejectedValue(value)](https://jestjs.io/docs/mock-function-api#mockfnmockrejectedvaluevalue)
- [x] [mockFn.mockRejectedValueOnce(value)](https://jestjs.io/docs/mock-function-api#mockfnmockrejectedvalueoncevalue)
- [x] [mockFn.withImplementation(fn, callback)](https://jestjs.io/docs/mock-function-api#mockfnwithimplementationfn-callback)

## `.spyOn()`

It's possible to track calls to a function without replacing it with a mock. Use `spyOn()` to create a spy; these spies can be passed to `.toHaveBeenCalled()` and `.toHaveBeenCalledTimes()`.

```ts
import { test, expect, spyOn } from "bun:test";

const ringo = {
  name: "Ringo",
  sayHi() {
    console.log(`Hello I'm ${this.name}`);
  },
};

const spy = spyOn(ringo, "sayHi");

test("spyon", () => {
  expect(spy).toHaveBeenCalledTimes(0);
  ringo.sayHi();
  expect(spy).toHaveBeenCalledTimes(1);
});
```

## Module mocks with `mock.module()`

Module mocking lets you override the behavior of a module. Use `mock.module(path: string, callback: () => Object)` to mock a module.

```ts
import { test, expect, mock } from "bun:test";

mock.module("./module", () => {
  return {
    foo: "bar",
  };
});

test("mock.module", async () => {
  const esm = await import("./module");
  expect(esm.foo).toBe("bar");

  const cjs = require("./module");
  expect(cjs.foo).toBe("bar");
});
```

Like the rest of Bun, module mocks support both `import` and `require`.

### Overriding already imported modules

If you need to override a module that's already been imported, there's nothing special you need to do. Just call `mock.module()` and the module will be overridden.

```ts
import { test, expect, mock } from "bun:test";

// The module we're going to mock is here:
import { foo } from "./module";

test("mock.module", async () => {
  const cjs = require("./module");
  expect(foo).toBe("bar");
  expect(cjs.foo).toBe("bar");

  // We update it here:
  mock.module("./module", () => {
    return {
      foo: "baz",
    };
  });

  // And the live bindings are updated.
  expect(foo).toBe("baz");

  // The module is also updated for CJS.
  expect(cjs.foo).toBe("baz");
});
```

### Hoisting & preloading

If you need to ensure a module is mocked before it's imported, you should use `--preload` to load your mocks before your tests run.

```ts
// my-preload.ts
import { mock } from "bun:test";

mock.module("./module", () => {
  return {
    foo: "bar",
  };
});
```

```sh
bun test --preload ./my-preload
```

To make your life easier, you can put `preload` in your `bunfig.toml`:

```toml

[test]
# Load these modules before running tests.
preload = ["./my-preload"]

```

#### What happens if I mock a module that's already been imported?

If you mock a module that's already been imported, the module will be updated in the module cache. This means that any modules that import the module will get the mocked version, BUT the original module will still have been evaluated. That means that any side effects from the original module will still have happened.

If you want to prevent the original module from being evaluated, you should use `--preload` to load your mocks before your tests run.

### `__mocks__` directory and auto-mocking

Auto-mocking is not supported yet. If this is blocking you from switching to Bun, please file an issue.

### Implementation details

Module mocks have different implementations for ESM and CommonJS modules. For ES Modules, we've added patches to JavaScriptCore that allow Bun to override export values at runtime and update live bindings recursively.

As of Bun v1.0.19, Bun automatically resolves the `specifier` argument to `mock.module()` as though you did an `import`. If it successfully resolves, then the resolved specifier string is used as the key in the module cache. This means that you can use relative paths, absolute paths, and even module names. If the `specifier` doesn't resolve, then the original `specifier` is used as the key in the module cache.

After resolution, the mocked module is stored in the ES Module registry **and** the CommonJS require cache. This means that you can use `import` and `require` interchangeably for mocked modules.

The callback function is called lazily, only if the module is imported or required. This means that you can use `mock.module()` to mock modules that don't exist yet, and it means that you can use `mock.module()` to mock modules that are imported by other modules.

## Restore all function mocks to their original values with `mock.restore()`

Instead of manually restoring each mock individually with `mockFn.mockRestore()`, restore all mocks with one command by calling `mock.restore()`. Doing so does not reset the value of modules overridden with `mock.module()`.

Using `mock.restore()` can reduce the amount of code in your tests by adding it to `afterEach` blocks in each test file or even in your [test preload code](https://bun.sh/docs/runtime/bunfig#test-preload).

```ts
import { expect, mock, spyOn, test } from "bun:test";

import * as fooModule from './foo.ts';
import * as barModule from './bar.ts';
import * as bazModule from './baz.ts';

test('foo, bar, baz', () => {
  const fooSpy = spyOn(fooModule, 'foo');
  const barSpy = spyOn(barModule, 'bar');
  const bazSpy = spyOn(bazModule, 'baz');

  expect(fooSpy).toBe('foo');
  expect(barSpy).toBe('bar');
  expect(bazSpy).toBe('baz');

  fooSpy.mockImplementation(() => 42);
  barSpy.mockImplementation(() => 43);
  bazSpy.mockImplementation(() => 44);

  expect(fooSpy).toBe(42);
  expect(barSpy).toBe(43);
  expect(bazSpy).toBe(44);

  mock.restore();

  expect(fooSpy).toBe('foo');
  expect(barSpy).toBe('bar');
  expect(bazSpy).toBe('baz');
});
```
