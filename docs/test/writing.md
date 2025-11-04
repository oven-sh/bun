Define tests with a Jest-like API imported from the built-in `bun:test` module. Long term, Bun aims for complete Jest compatibility; at the moment, a [limited set](#matchers) of `expect` matchers are supported.

## Basic usage

To define a simple test:

```ts#math.test.ts
import { expect, test } from "bun:test";

test("2 + 2", () => {
  expect(2 + 2).toBe(4);
});
```

{% details summary="Jest-style globals" %}
As in Jest, you can use `describe`, `test`, `expect`, and other functions without importing them. Unlike Jest, they are not injected into the global scope. Instead, the Bun transpiler will automatically inject an import from `bun:test` internally.

```ts
typeof globalThis.describe; // "undefined"
typeof describe; // "function"
```

This transpiler integration only occurs during `bun test`, and only for test files & preloaded scripts. In practice there's no significant difference to the end user.
{% /details %}

Tests can be grouped into suites with `describe`.

```ts#math.test.ts
import { expect, test, describe } from "bun:test";

describe("arithmetic", () => {
  test("2 + 2", () => {
    expect(2 + 2).toBe(4);
  });

  test("2 * 2", () => {
    expect(2 * 2).toBe(4);
  });
});
```

Tests can be `async`.

```ts
import { expect, test } from "bun:test";

test("2 * 2", async () => {
  const result = await Promise.resolve(2 * 2);
  expect(result).toEqual(4);
});
```

Alternatively, use the `done` callback to signal completion. If you include the `done` callback as a parameter in your test definition, you _must_ call it or the test will hang.

```ts
import { expect, test } from "bun:test";

test("2 * 2", done => {
  Promise.resolve(2 * 2).then(result => {
    expect(result).toEqual(4);
    done();
  });
});
```

## Timeouts

Optionally specify a per-test timeout in milliseconds by passing a number as the third argument to `test`.

```ts
import { test } from "bun:test";

test("wat", async () => {
  const data = await slowOperation();
  expect(data).toBe(42);
}, 500); // test must run in <500ms
```

In `bun:test`, test timeouts throw an uncatchable exception to force the test to stop running and fail. We also kill any child processes that were spawned in the test to avoid leaving behind zombie processes lurking in the background.

The default timeout for each test is 5000ms (5 seconds) if not overridden by this timeout option or `jest.setDefaultTimeout()`.

### 🧟 Zombie process killer

When a test times out and processes spawned in the test via `Bun.spawn`, `Bun.spawnSync`, or `node:child_process` are not killed, they will be automatically killed and a message will be logged to the console. This prevents zombie processes from lingering in the background after timed-out tests.

## `test.skip`

Skip individual tests with `test.skip`. These tests will not be run.

```ts
import { expect, test } from "bun:test";

test.skip("wat", () => {
  // TODO: fix this
  expect(0.1 + 0.2).toEqual(0.3);
});
```

## `test.todo`

Mark a test as a todo with `test.todo`. These tests will not be run.

```ts
import { expect, test } from "bun:test";

test.todo("fix this", () => {
  myTestFunction();
});
```

To run todo tests and find any which are passing, use `bun test --todo`.

```sh
$ bun test --todo
my.test.ts:
✗ unimplemented feature
  ^ this test is marked as todo but passes. Remove `.todo` or check that test is correct.

 0 pass
 1 fail
 1 expect() calls
```

With this flag, failing todo tests will not cause an error, but todo tests which pass will be marked as failing so you can remove the todo mark or
fix the test.

## `test.only`

To run a particular test or suite of tests use `test.only()` or `describe.only()`.

```ts
import { test, describe } from "bun:test";

test("test #1", () => {
  // does not run
});

test.only("test #2", () => {
  // runs
});

describe.only("only", () => {
  test("test #3", () => {
    // runs
  });
});
```

The following command will only execute tests #2 and #3.

```sh
$ bun test
```

## `test.if`

To run a test conditionally, use `test.if()`. The test will run if the condition is truthy. This is particularly useful for tests that should only run on specific architectures or operating systems.

```ts
test.if(Math.random() > 0.5)("runs half the time", () => {
  // ...
});

const macOS = process.arch === "darwin";
test.if(macOS)("runs on macOS", () => {
  // runs if macOS
});
```

## `test.skipIf`

To instead skip a test based on some condition, use `test.skipIf()` or `describe.skipIf()`.

```ts
const macOS = process.arch === "darwin";

test.skipIf(macOS)("runs on non-macOS", () => {
  // runs if *not* macOS
});
```

## `test.todoIf`

If instead you want to mark the test as TODO, use `test.todoIf()` or `describe.todoIf()`. Carefully choosing `skipIf` or `todoIf` can show a difference between, for example, intent of "invalid for this target" and "planned but not implemented yet."

```ts
const macOS = process.arch === "darwin";

// TODO: we've only implemented this for Linux so far.
test.todoIf(macOS)("runs on posix", () => {
  // runs if *not* macOS
});
```

## `test.failing`

Use `test.failing()` when you know a test is currently failing but you want to track it and be notified when it starts passing. This inverts the test result:

- A failing test marked with `.failing()` will pass
- A passing test marked with `.failing()` will fail (with a message indicating it's now passing and should be fixed)

```ts
// This will pass because the test is failing as expected
test.failing("math is broken", () => {
  expect(0.1 + 0.2).toBe(0.3); // fails due to floating point precision
});

// This will fail with a message that the test is now passing
test.failing("fixed bug", () => {
  expect(1 + 1).toBe(2); // passes, but we expected it to fail
});
```

This is useful for tracking known bugs that you plan to fix later, or for implementing test-driven development.

## Conditional Tests for Describe Blocks

The conditional modifiers `.if()`, `.skipIf()`, and `.todoIf()` can also be applied to `describe` blocks, affecting all tests within the suite:

```ts
const isMacOS = process.platform === "darwin";

// Only runs the entire suite on macOS
describe.if(isMacOS)("macOS-specific features", () => {
  test("feature A", () => {
    // only runs on macOS
  });

  test("feature B", () => {
    // only runs on macOS
  });
});

// Skips the entire suite on Windows
describe.skipIf(process.platform === "win32")("Unix features", () => {
  test("feature C", () => {
    // skipped on Windows
  });
});

// Marks the entire suite as TODO on Linux
describe.todoIf(process.platform === "linux")("Upcoming Linux support", () => {
  test("feature D", () => {
    // marked as TODO on Linux
  });
});
```

## `test.each` and `describe.each`

To run the same test with multiple sets of data, use `test.each`. This creates a parametrized test that runs once for each test case provided.

```ts
const cases = [
  [1, 2, 3],
  [3, 4, 7],
];

test.each(cases)("%p + %p should be %p", (a, b, expected) => {
  expect(a + b).toBe(expected);
});
```

You can also use `describe.each` to create a parametrized suite that runs once for each test case:

```ts
describe.each([
  [1, 2, 3],
  [3, 4, 7],
])("add(%i, %i)", (a, b, expected) => {
  test(`returns ${expected}`, () => {
    expect(a + b).toBe(expected);
  });

  test(`sum is greater than each value`, () => {
    expect(a + b).toBeGreaterThan(a);
    expect(a + b).toBeGreaterThan(b);
  });
});
```

### Argument Passing

How arguments are passed to your test function depends on the structure of your test cases:

- If a table row is an array (like `[1, 2, 3]`), each element is passed as an individual argument
- If a row is not an array (like an object), it's passed as a single argument

```ts
// Array items passed as individual arguments
test.each([
  [1, 2, 3],
  [4, 5, 9],
])("add(%i, %i) = %i", (a, b, expected) => {
  expect(a + b).toBe(expected);
});

// Object items passed as a single argument
test.each([
  { a: 1, b: 2, expected: 3 },
  { a: 4, b: 5, expected: 9 },
])("add($a, $b) = $expected", data => {
  expect(data.a + data.b).toBe(data.expected);
});
```

### Format Specifiers

There are a number of options available for formatting the test title:

{% table %}

---

- `%p`
- [`pretty-format`](https://www.npmjs.com/package/pretty-format)

---

- `%s`
- String

---

- `%d`
- Number

---

- `%i`
- Integer

---

- `%f`
- Floating point

---

- `%j`
- JSON

---

- `%o`
- Object

---

- `%#`
- Index of the test case

---

- `%%`
- Single percent sign (`%`)

{% /table %}

#### Examples

```ts
// Basic specifiers
test.each([
  ["hello", 123],
  ["world", 456],
])("string: %s, number: %i", (str, num) => {
  // "string: hello, number: 123"
  // "string: world, number: 456"
});

// %p for pretty-format output
test.each([
  [{ name: "Alice" }, { a: 1, b: 2 }],
  [{ name: "Bob" }, { x: 5, y: 10 }],
])("user %p with data %p", (user, data) => {
  // "user { name: 'Alice' } with data { a: 1, b: 2 }"
  // "user { name: 'Bob' } with data { x: 5, y: 10 }"
});

// %# for index
test.each(["apple", "banana"])("fruit #%# is %s", fruit => {
  // "fruit #0 is apple"
  // "fruit #1 is banana"
});
```

## Assertion Counting

Bun supports verifying that a specific number of assertions were called during a test:

### expect.hasAssertions()

Use `expect.hasAssertions()` to verify that at least one assertion is called during a test:

```ts
test("async work calls assertions", async () => {
  expect.hasAssertions(); // Will fail if no assertions are called

  const data = await fetchData();
  expect(data).toBeDefined();
});
```

This is especially useful for async tests to ensure your assertions actually run.

### expect.assertions(count)

Use `expect.assertions(count)` to verify that a specific number of assertions are called during a test:

```ts
test("exactly two assertions", () => {
  expect.assertions(2); // Will fail if not exactly 2 assertions are called

  expect(1 + 1).toBe(2);
  expect("hello").toContain("ell");
});
```

This helps ensure all your assertions run, especially in complex async code with multiple code paths.

## Type Testing

Bun includes `expectTypeOf` for testing typescript types, compatible with Vitest.

### expectTypeOf

{% callout %}

**Note** — These functions are no-ops at runtime - you need to run TypeScript separately to verify the type checks.

{% endcallout %}

The `expectTypeOf` function provides type-level assertions that are checked by TypeScript's type checker. **Important**:

To test your types:

1. Write your type assertions using `expectTypeOf`
2. Run `bunx tsc --noEmit` to check that your types are correct

```ts
import { expectTypeOf } from "bun:test";

// Basic type assertions
expectTypeOf<string>().toEqualTypeOf<string>();
expectTypeOf(123).toBeNumber();
expectTypeOf("hello").toBeString();

// Object type matching
expectTypeOf({ a: 1, b: "hello" }).toMatchObjectType<{ a: number }>();

// Function types
function greet(name: string): string {
  return `Hello ${name}`;
}

expectTypeOf(greet).toBeFunction();
expectTypeOf(greet).parameters.toEqualTypeOf<[string]>();
expectTypeOf(greet).returns.toEqualTypeOf<string>();

// Array types
expectTypeOf([1, 2, 3]).items.toBeNumber();

// Promise types
expectTypeOf(Promise.resolve(42)).resolves.toBeNumber();
```

For full documentation on expectTypeOf matchers, see the [API Reference](/reference/bun/test/expectTypeOf)

## Matchers

Bun implements the following matchers. Full Jest compatibility is on the roadmap; track progress [here](https://github.com/oven-sh/bun/issues/1825).

{% table %}

---

- ✅
- [`.not`](https://jestjs.io/docs/expect#not)

---

- ✅
- [`.toBe()`](https://jestjs.io/docs/expect#tobevalue)

---

- ✅
- [`.toEqual()`](https://jestjs.io/docs/expect#toequalvalue)

---

- ✅
- [`.toBeNull()`](https://jestjs.io/docs/expect#tobenull)

---

- ✅
- [`.toBeUndefined()`](https://jestjs.io/docs/expect#tobeundefined)

---

- ✅
- [`.toBeNaN()`](https://jestjs.io/docs/expect#tobenan)

---

- ✅
- [`.toBeDefined()`](https://jestjs.io/docs/expect#tobedefined)

---

- ✅
- [`.toBeFalsy()`](https://jestjs.io/docs/expect#tobefalsy)

---

- ✅
- [`.toBeTruthy()`](https://jestjs.io/docs/expect#tobetruthy)

---

- ✅
- [`.toContain()`](https://jestjs.io/docs/expect#tocontainitem)

---

- ✅
- [`.toContainAllKeys()`](https://jest-extended.jestcommunity.dev/docs/matchers/Object#tocontainallkeyskeys)

---

- ✅
- [`.toContainValue()`](https://jest-extended.jestcommunity.dev/docs/matchers/Object#tocontainvaluevalue)

---

- ✅
- [`.toContainValues()`](https://jest-extended.jestcommunity.dev/docs/matchers/Object#tocontainvaluesvalues)

---

- ✅
- [`.toContainAllValues()`](https://jest-extended.jestcommunity.dev/docs/matchers/Object#tocontainallvaluesvalues)

---

- ✅
- [`.toContainAnyValues()`](https://jest-extended.jestcommunity.dev/docs/matchers/Object#tocontainanyvaluesvalues)

---

- ✅
- [`.toStrictEqual()`](https://jestjs.io/docs/expect#tostrictequalvalue)

---

- ✅
- [`.toThrow()`](https://jestjs.io/docs/expect#tothrowerror)

---

- ✅
- [`.toHaveLength()`](https://jestjs.io/docs/expect#tohavelengthnumber)

---

- ✅
- [`.toHaveProperty()`](https://jestjs.io/docs/expect#tohavepropertykeypath-value)

---

- ✅
- [`.extend`](https://jestjs.io/docs/expect#expectextendmatchers)

---

- ✅
- [`.anything()`](https://jestjs.io/docs/expect#expectanything)

---

- ✅
- [`.any()`](https://jestjs.io/docs/expect#expectanyconstructor)

---

- ✅
- [`.arrayContaining()`](https://jestjs.io/docs/expect#expectarraycontainingarray)

---

- ✅
- [`.assertions()`](https://jestjs.io/docs/expect#expectassertionsnumber)

---

- ✅
- [`.closeTo()`](https://jestjs.io/docs/expect#expectclosetonumber-numdigits)

---

- ✅
- [`.hasAssertions()`](https://jestjs.io/docs/expect#expecthasassertions)

---

- ✅
- [`.objectContaining()`](https://jestjs.io/docs/expect#expectobjectcontainingobject)

---

- ✅
- [`.stringContaining()`](https://jestjs.io/docs/expect#expectstringcontainingstring)

---

- ✅
- [`.stringMatching()`](https://jestjs.io/docs/expect#expectstringmatchingstring--regexp)

---

- ❌
- [`.addSnapshotSerializer()`](https://jestjs.io/docs/expect#expectaddsnapshotserializerserializer)

---

- ✅
- [`.resolves()`](https://jestjs.io/docs/expect#resolves)

---

- ✅
- [`.rejects()`](https://jestjs.io/docs/expect#rejects)

---

- ✅
- [`.toHaveBeenCalled()`](https://jestjs.io/docs/expect#tohavebeencalled)

---

- ✅
- [`.toHaveBeenCalledTimes()`](https://jestjs.io/docs/expect#tohavebeencalledtimesnumber)

---

- ✅
- [`.toHaveBeenCalledWith()`](https://jestjs.io/docs/expect#tohavebeencalledwitharg1-arg2-)

---

- ✅
- [`.toHaveBeenLastCalledWith()`](https://jestjs.io/docs/expect#tohavebeenlastcalledwitharg1-arg2-)

---

- ✅
- [`.toHaveBeenNthCalledWith()`](https://jestjs.io/docs/expect#tohavebeennthcalledwithnthcall-arg1-arg2-)

---

- ✅
- [`.toHaveReturned()`](https://jestjs.io/docs/expect#tohavereturned)

---

- ✅
- [`.toHaveReturnedTimes()`](https://jestjs.io/docs/expect#tohavereturnedtimesnumber)

---

- ✅
- [`.toHaveReturnedWith()`](https://jestjs.io/docs/expect#tohavereturnedwithvalue)

---

- ✅
- [`.toHaveLastReturnedWith()`](https://jestjs.io/docs/expect#tohavelastreturnedwithvalue)

---

- ✅
- [`.toHaveNthReturnedWith()`](https://jestjs.io/docs/expect#tohaventhreturnedwithnthcall-value)

---

- ✅
- [`.toBeCloseTo()`](https://jestjs.io/docs/expect#tobeclosetonumber-numdigits)

---

- ✅
- [`.toBeGreaterThan()`](https://jestjs.io/docs/expect#tobegreaterthannumber--bigint)

---

- ✅
- [`.toBeGreaterThanOrEqual()`](https://jestjs.io/docs/expect#tobegreaterthanorequalnumber--bigint)

---

- ✅
- [`.toBeLessThan()`](https://jestjs.io/docs/expect#tobelessthannumber--bigint)

---

- ✅
- [`.toBeLessThanOrEqual()`](https://jestjs.io/docs/expect#tobelessthanorequalnumber--bigint)

---

- ✅
- [`.toBeInstanceOf()`](https://jestjs.io/docs/expect#tobeinstanceofclass)

---

- ✅
- [`.toContainEqual()`](https://jestjs.io/docs/expect#tocontainequalitem)

---

- ✅
- [`.toMatch()`](https://jestjs.io/docs/expect#tomatchregexp--string)

---

- ✅
- [`.toMatchObject()`](https://jestjs.io/docs/expect#tomatchobjectobject)

---

- ✅
- [`.toMatchSnapshot()`](https://jestjs.io/docs/expect#tomatchsnapshotpropertymatchers-hint)

---

- ✅
- [`.toMatchInlineSnapshot()`](https://jestjs.io/docs/expect#tomatchinlinesnapshotpropertymatchers-inlinesnapshot)

---

- ✅
- [`.toThrowErrorMatchingSnapshot()`](https://jestjs.io/docs/expect#tothrowerrormatchingsnapshothint)

---

- ✅
- [`.toThrowErrorMatchingInlineSnapshot()`](https://jestjs.io/docs/expect#tothrowerrormatchinginlinesnapshotinlinesnapshot)

{% /table %}

## TypeScript Type Safety

Bun's test runner provides enhanced TypeScript support with intelligent type checking for your test assertions. The type system helps catch potential bugs at compile time while still allowing flexibility when needed.

### Strict Type Checking by Default

By default, Bun's test matchers enforce strict type checking between the actual value and expected value:

```ts
import { expect, test } from "bun:test";

test("strict typing", () => {
  const str = "hello";
  const num = 42;

  expect(str).toBe("hello"); // ✅ OK: string to string
  expect(num).toBe(42); // ✅ OK: number to number
  expect(str).toBe(42); // ❌ TypeScript error: string vs number
});
```

This helps catch common mistakes where you might accidentally compare values of different types.

### Relaxed Type Checking with Type Parameters

Sometimes you need more flexibility in your tests, especially when working with:

- Dynamic data from APIs
- Polymorphic functions that can return multiple types
- Generic utility functions
- Migration of existing test suites

For these cases, you can "opt out" of strict type checking by providing an explicit type parameter to matcher methods:

```ts
import { expect, test } from "bun:test";

test("relaxed typing with type parameters", () => {
  const value: unknown = getSomeValue();

  // These would normally cause TypeScript errors, but type parameters allow them:
  expect(value).toBe<number>(42); // No TS error, runtime check still works
  expect(value).toEqual<string>("hello"); // No TS error, runtime check still works
  expect(value).toStrictEqual<boolean>(true); // No TS error, runtime check still works
});

test("useful for dynamic data", () => {
  const apiResponse: any = { status: "success" };

  // Without type parameter: TypeScript error (any vs string)
  // expect(apiResponse.status).toBe("success");

  // With type parameter: No TypeScript error, runtime assertion still enforced
  expect(apiResponse.status).toBe<string>("success"); // ✅ OK
});
```

### Migration from Looser Type Systems

If migrating from a test framework with looser TypeScript integration, you can use type parameters as a stepping stone:

```ts
// Old Jest test that worked but wasn't type-safe
expect(response.data).toBe(200); // No type error in some setups

// Bun equivalent with explicit typing during migration
expect(response.data).toBe<number>(200); // Explicit about expected type

// Ideal Bun test after refactoring
const statusCode: number = response.data;
expect(statusCode).toBe(200); // Type-safe without explicit parameter
```
