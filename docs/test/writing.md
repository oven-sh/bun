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

Mark a test as a todo with `test.todo`. These tests _will_ be run, and the test runner will expect them to fail. If they pass, you will be prompted to mark it as a regular test.

```ts
import { expect, test } from "bun:test";

test.todo("fix this", () => {
  myTestFunction();
});
```

To exclusively run tests marked as _todo_, use `bun test --todo`.

```sh
$ bun test --todo
```

## `test.only`

To run a particular test or suite of tests use `test.only()` or `describe.only()`. Once declared, running `bun test --only` will only execute tests/suites that have been marked with `.only()`.

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

To instead skip a test based on some condition, use `test.skipIf()` or `describe.skipIf()`.

```ts
const macOS = process.arch === "darwin";

test.skipIf(macOS)("runs on non-macOS", () => {
  // runs if *not* macOS
});
```

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

- ❌
- [`.extend`](https://jestjs.io/docs/expect#expectextendmatchers)

---

- ✅
- [`.anything()`](https://jestjs.io/docs/expect#expectanything)

---

- ✅
- [`.any()`](https://jestjs.io/docs/expect#expectanyconstructor)

---

- ❌
- [`.arrayContaining()`](https://jestjs.io/docs/expect#expectarraycontainingarray)

---

- ❌
- [`.assertions()`](https://jestjs.io/docs/expect#expectassertionsnumber)

---

- ❌
- [`.closeTo()`](https://jestjs.io/docs/expect#expectclosetonumber-numdigits)

---

- ❌
- [`.hasAssertions()`](https://jestjs.io/docs/expect#expecthasassertions)

---

- ❌
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

- ❌
- [`.toHaveBeenCalledWith()`](https://jestjs.io/docs/expect#tohavebeencalledwitharg1-arg2-)

---

- ❌
- [`.toHaveBeenLastCalledWith()`](https://jestjs.io/docs/expect#tohavebeenlastcalledwitharg1-arg2-)

---

- ❌
- [`.toHaveBeenNthCalledWith()`](https://jestjs.io/docs/expect#tohavebeennthcalledwithnthcall-arg1-arg2-)

---

- ❌
- [`.toHaveReturned()`](https://jestjs.io/docs/expect#tohavereturned)

---

- ❌
- [`.toHaveReturnedTimes()`](https://jestjs.io/docs/expect#tohavereturnedtimesnumber)

---

- ❌
- [`.toHaveReturnedWith()`](https://jestjs.io/docs/expect#tohavereturnedwithvalue)

---

- ❌
- [`.toHaveLastReturnedWith()`](https://jestjs.io/docs/expect#tohavelastreturnedwithvalue)

---

- ❌
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

- ❌
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

- ❌
- [`.toMatchInlineSnapshot()`](https://jestjs.io/docs/expect#tomatchinlinesnapshotpropertymatchers-inlinesnapshot)

---

- ❌
- [`.toThrowErrorMatchingSnapshot()`](https://jestjs.io/docs/expect#tothrowerrormatchingsnapshothint)

---

- ❌
- [`.toThrowErrorMatchingInlineSnapshot()`](https://jestjs.io/docs/expect#tothrowerrormatchinginlinesnapshotinlinesnapshot)

{% /table %}
