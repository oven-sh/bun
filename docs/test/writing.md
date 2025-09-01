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
$ bun test --only
```

The following command will only execute tests #1, #2 and #3.

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

Bun includes `expectTypeOf` for testing TypeScript types, providing full compatibility with Vitest's type testing API.

### expectTypeOf

{% callout %}

**Note** — These functions are no-ops at runtime - you need to run TypeScript separately to verify the type checks.

{% endcallout %}

The `expectTypeOf` function provides type-level assertions that are checked by TypeScript's type checker. **Important**:

To test your types:

1. Write your type assertions using `expectTypeOf`
2. Run `bunx tsc --noEmit` to check that your types are correct

#### Basic Type Assertions

```ts
import { expectTypeOf } from "bun:test";

// Primitive types
expectTypeOf("hello").toBeString();
expectTypeOf(123).toBeNumber();
expectTypeOf(true).toBeBoolean();
expectTypeOf(Symbol("test")).toBeSymbol();
expectTypeOf(undefined).toBeUndefined();
expectTypeOf(null).toBeNull();
expectTypeOf(() => {}).toBeFunction();

// Complex types  
expectTypeOf([1, 2, 3]).toBeArray();
expectTypeOf({ a: 1 }).toBeObject();
```

#### Type Equality

Use `toEqualTypeOf` for strict type equality checks:

```ts
// Generic syntax
expectTypeOf<string>().toEqualTypeOf<string>();
expectTypeOf<{ name: string; age: number }>().toEqualTypeOf<{ name: string; age: number }>();

// Inferred syntax
expectTypeOf("hello").toEqualTypeOf<string>();
expectTypeOf({ name: "Alice", age: 30 }).toEqualTypeOf<{ name: string; age: number }>();

// Using with values for inference
const user = { name: "Alice", age: 30 };
expectTypeOf(user).toEqualTypeOf<{ name: string; age: number }>();
```

#### Object Type Matching

For testing object shapes without requiring exact matches, use `toMatchObjectType`:

```ts
interface User {
  name: string;
  age: number;
  email?: string;
}

const user = { name: "Alice", age: 30, isActive: true };

// This passes - user has at least the required properties
expectTypeOf(user).toMatchObjectType<{ name: string; age: number }>();

// This would fail - user doesn't have email property
// expectTypeOf(user).toMatchObjectType<{ name: string; email: string }>();
```

#### Function Types

Test function signatures, parameters, and return types:

```ts
function greet(name: string): string {
  return `Hello ${name}`;
}

async function fetchUser(id: number): Promise<User> {
  // implementation
}

// Function type checks
expectTypeOf(greet).toBeFunction();
expectTypeOf(greet).parameters.toEqualTypeOf<[string]>();
expectTypeOf(greet).returns.toEqualTypeOf<string>();

// Async function checks
expectTypeOf(fetchUser).parameters.toEqualTypeOf<[number]>();
expectTypeOf(fetchUser).returns.resolves.toMatchObjectType<User>();
```

#### Array and Promise Types

```ts
// Array item types
expectTypeOf([1, 2, 3]).items.toBeNumber();
expectTypeOf(["a", "b", "c"]).items.toBeString();

// Promise resolution types
expectTypeOf(Promise.resolve(42)).resolves.toBeNumber();
expectTypeOf(Promise.resolve("hello")).resolves.toBeString();

// Array of promises
expectTypeOf([Promise.resolve(1), Promise.resolve(2)]).items.resolves.toBeNumber();
```

#### Negation with `.not`

Use `.not` to assert that types do NOT match:

```ts
expectTypeOf("hello").not.toBeNumber();
expectTypeOf(123).not.toBeString();
expectTypeOf({ a: 1 }).not.toEqualTypeOf<{ a: string }>();
```

#### Advanced Examples

```ts
// Generic type testing
function identity<T>(value: T): T {
  return value;
}

expectTypeOf(identity).toBeCallableWith("hello");
expectTypeOf(identity<string>).parameters.toEqualTypeOf<[string]>();
expectTypeOf(identity<number>).returns.toEqualTypeOf<number>();

// Union types
type Status = "loading" | "success" | "error";
const status: Status = "loading";
expectTypeOf(status).toMatchTypeOf<Status>();

// Branded types
type UserId = string & { readonly brand: unique symbol };
declare const userId: UserId;
expectTypeOf(userId).toBeString();
expectTypeOf(userId).not.toEqualTypeOf<string>();
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

## Mock Return Value Matchers

Bun provides several matchers specifically for testing mock function return values. These matchers are particularly useful when you need to verify that mocked functions returned specific values during execution.

### `.toHaveReturnedWith()`

Use `toHaveReturnedWith` to verify that a mock function returned a specific value at least once:

```ts
import { expect, test, mock } from "bun:test";

test("mock return value testing", () => {
  const mockCalculate = mock((a: number, b: number) => a + b);

  mockCalculate(2, 3);
  mockCalculate(10, 5);

  // Verify the mock returned 5 at least once
  expect(mockCalculate).toHaveReturnedWith(5);
  
  // Verify the mock returned 15 at least once  
  expect(mockCalculate).toHaveReturnedWith(15);
});
```

### `.toHaveLastReturnedWith()`

Use `toHaveLastReturnedWith` to verify that a mock function's most recent call returned a specific value:

```ts
import { expect, test, mock } from "bun:test";

test("last return value testing", () => {
  const mockGreet = mock((name: string) => `Hello, ${name}!`);

  mockGreet("Alice");
  mockGreet("Bob");
  mockGreet("Charlie");

  // Verify the most recent call returned "Hello, Charlie!"
  expect(mockGreet).toHaveLastReturnedWith("Hello, Charlie!");
});
```

### `.toHaveNthReturnedWith()`

Use `toHaveNthReturnedWith` to verify that a mock function returned a specific value on the nth call (1-indexed):

```ts
import { expect, test, mock } from "bun:test";

test("nth return value testing", () => {
  const mockMultiply = mock((a: number, b: number) => a * b);

  mockMultiply(2, 3);    // 1st call returns 6
  mockMultiply(4, 5);    // 2nd call returns 20
  mockMultiply(10, 2);   // 3rd call returns 20

  // Verify the 1st call returned 6
  expect(mockMultiply).toHaveNthReturnedWith(1, 6);
  
  // Verify the 2nd call returned 20
  expect(mockMultiply).toHaveNthReturnedWith(2, 20);
  
  // Verify the 3rd call returned 20
  expect(mockMultiply).toHaveNthReturnedWith(3, 20);
});
```

### Complex Return Value Testing

These matchers work with complex return values like objects and arrays:

```ts
import { expect, test, mock } from "bun:test";

test("complex return values", () => {
  const mockCreateUser = mock((name: string, age: number) => ({ 
    name, 
    age, 
    id: Math.floor(Math.random() * 1000) 
  }));

  const user1 = mockCreateUser("Alice", 25);
  const user2 = mockCreateUser("Bob", 30);

  // Test with objects using partial matching
  expect(mockCreateUser).toHaveReturnedWith(
    expect.objectContaining({ name: "Alice", age: 25 })
  );
  
  // Test the last returned value
  expect(mockCreateUser).toHaveLastReturnedWith(
    expect.objectContaining({ name: "Bob", age: 30 })
  );
  
  // Test specific call's return value
  expect(mockCreateUser).toHaveNthReturnedWith(1, 
    expect.objectContaining({ name: "Alice", age: 25 })
  );
});
```

### Working with Async Functions

These matchers also work with async functions and promises:

```ts
import { expect, test, mock } from "bun:test";

test("async mock return values", async () => {
  const mockFetchUser = mock(async (id: number) => ({ 
    id, 
    name: `User ${id}`,
    email: `user${id}@example.com`
  }));

  await mockFetchUser(1);
  await mockFetchUser(2);

  // Test resolved values
  await expect(mockFetchUser).toHaveReturnedWith(
    Promise.resolve(expect.objectContaining({ id: 1, name: "User 1" }))
  );
  
  await expect(mockFetchUser).toHaveLastReturnedWith(
    Promise.resolve(expect.objectContaining({ id: 2, name: "User 2" }))
  );
});
```

## Global Mock Management

Bun provides utilities for managing all your mocks at once, which is particularly useful in test setup and teardown.

### `mock.clearAllMocks()`

Reset all mock function state (calls, results, etc.) without restoring their original implementations:

```ts
import { expect, mock, test } from "bun:test";

test("clearing all mocks", () => {
  const mockFn1 = mock(() => "result1");
  const mockFn2 = mock(() => "result2");

  // Use the mocks
  mockFn1();
  mockFn2();

  expect(mockFn1).toHaveBeenCalledTimes(1);
  expect(mockFn2).toHaveBeenCalledTimes(1);

  // Clear all mock history
  mock.clearAllMocks();

  // Call counts are reset
  expect(mockFn1).toHaveBeenCalledTimes(0);
  expect(mockFn2).toHaveBeenCalledTimes(0);

  // But implementations are preserved
  expect(mockFn1()).toBe("result1");
  expect(mockFn2()).toBe("result2");
});
```

This is useful in test setup to ensure a clean state:

```ts
import { mock, beforeEach } from "bun:test";

beforeEach(() => {
  // Reset all mock state before each test
  mock.clearAllMocks();
});
```
