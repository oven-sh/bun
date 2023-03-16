Bun ships with a built-in test runner.

```bash
$ bun test
```

Tests are written in JavaScript or TypeScript with a Jest-like API.

```ts#math.test.ts
import { expect, test } from "bun:test";

test("2 + 2", () => {
  expect(2 + 2).toBe(4);
});
```

It's fast.

{% image src="/images/buntest.jpeg" caption="Bun runs 266 React SSR tests faster than Jest can print its version number." /%}

The runner recursively searches the working directory for files that match the following patterns:

- `*.test.{js|jsx|ts|tsx}`
- `*_test.{js|jsx|ts|tsx}`
- `*.spec.{js|jsx|ts|tsx}`
- `*_spec.{js|jsx|ts|tsx}`

You can filter the set of tests to run by passing additional positional arguments to `bun test`. Any file in the directory with an _absolute path_ that contains one of the filters will run. Commonly, these filters will be file or directory names; glob patterns are not yet supported.

```bash
$ bun test <filter> <filter> ...
```

<!--
Consider the following directory structure:

```
.
├── a.test.ts
├── b.test.ts
├── c.test.ts
└── foo
    ├── a.test.ts
    └── b.test.ts
```

To run both `a.test.ts` files:

```
$ bun test a
```

To run all tests in the `foo` directory:

```
$ bun test foo
```

Any test file in the directory with an _absolute path_ that contains one of the targets will run. Glob patterns are not yet supported. -->

## Writing tests

Define tests with a Jest-like API imported from the built-in `bun:test` module.

```ts#math.test.ts
import { expect, test } from "bun:test";

test("2 + 2", () => {
  expect(2 + 2).toBe(4);
});
```

Group tests into suites with `describe`.

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

Perform per-test setup and teardown logic with `beforeEach` and `afterEach`.

```ts
import { expect, test } from "bun:test";

beforeEach(() => {
  console.log("running test.");
});

afterEach(() => {
  console.log("done with test.");
});

// tests...
```

Perform per-scope setup and teardown logic with `beforeAll` and `afterAll`. At the top-level, the _scope_ is the current file; in a `describe` block, the scope is the block itself.

```ts
import { expect, test, beforeAll, afterAll } from "bun:test";

let db: Database;
beforeAll(() => {
  // connect to database
});

afterAll(() => {
  // close connection
});

// tests...
```

Skip individual tests with `test.skip`.

```ts
import { expect, test } from "bun:test";

test.skip("wat", () => {
  // TODO: fix this
  expect(0.1 + 0.2).toEqual(0.3);
});
```

## Expect matchers

Bun implements the following matchers. Full Jest compatibility is on the roadmap; track progress [here](https://github.com/oven-sh/bun/issues/1825).

- [x] [`.not`](https://jestjs.io/docs/expect#not)
- [x] [`.toBe()`](https://jestjs.io/docs/expect#tobevalue)
- [x] [`.toEqual()`](https://jestjs.io/docs/expect#toequalvalue)
- [x] [`.toBeNull()`](https://jestjs.io/docs/expect#tobenull)
- [x] [`.toBeUndefined()`](https://jestjs.io/docs/expect#tobeundefined)
- [x] [`.toBeNaN()`](https://jestjs.io/docs/expect#tobenan)
- [x] [`.toBeDefined()`](https://jestjs.io/docs/expect#tobedefined)
- [x] [`.toBeFalsy()`](https://jestjs.io/docs/expect#tobefalsy)
- [x] [`.toBeTruthy()`](https://jestjs.io/docs/expect#tobetruthy)
- [x] [`.toContain()`](https://jestjs.io/docs/expect#tocontainitem)
- [x] [`.toStrictEqual()`](https://jestjs.io/docs/expect#tostrictequalvalue)
- [x] [`.toThrow()`](https://jestjs.io/docs/expect#tothrowerror)
- [x] [`.toHaveLength()`](https://jestjs.io/docs/expect#tohavelengthnumber)
- [x] [`.toHaveProperty()`](https://jestjs.io/docs/expect#tohavepropertykeypath-value)
- [ ] [`.extend`](https://jestjs.io/docs/expect#expectextendmatchers)
- [ ] [`.anything()`](https://jestjs.io/docs/expect#expectanything)
- [ ] [`.any()`](https://jestjs.io/docs/expect#expectanyconstructor)
- [ ] [`.arrayContaining()`](https://jestjs.io/docs/expect#expectarraycontainingarray)
- [ ] [`.assertions()`](https://jestjs.io/docs/expect#expectassertionsnumber)
- [ ] [`.closeTo()`](https://jestjs.io/docs/expect#expectclosetonumber-numdigits)
- [ ] [`.hasAssertions()`](https://jestjs.io/docs/expect#expecthasassertions)
- [ ] [`.objectContaining()`](https://jestjs.io/docs/expect#expectobjectcontainingobject)
- [ ] [`.stringContaining()`](https://jestjs.io/docs/expect#expectstringcontainingstring)
- [ ] [`.stringMatching()`](https://jestjs.io/docs/expect#expectstringmatchingstring--regexp)
- [ ] [`.addSnapshotSerializer()`](https://jestjs.io/docs/expect#expectaddsnapshotserializerserializer)
- [ ] [`.resolves()`](https://jestjs.io/docs/expect#resolves)
- [ ] [`.rejects()`](https://jestjs.io/docs/expect#rejects)
- [ ] [`.toHaveBeenCalled()`](https://jestjs.io/docs/expect#tohavebeencalled)
- [ ] [`.toHaveBeenCalledTimes()`](https://jestjs.io/docs/expect#tohavebeencalledtimesnumber)
- [ ] [`.toHaveBeenCalledWith()`](https://jestjs.io/docs/expect#tohavebeencalledwitharg1-arg2-)
- [ ] [`.toHaveBeenLastCalledWith()`](https://jestjs.io/docs/expect#tohavebeenlastcalledwitharg1-arg2-)
- [ ] [`.toHaveBeenNthCalledWith()`](https://jestjs.io/docs/expect#tohavebeennthcalledwithnthcall-arg1-arg2-)
- [ ] [`.toHaveReturned()`](https://jestjs.io/docs/expect#tohavereturned)
- [ ] [`.toHaveReturnedTimes()`](https://jestjs.io/docs/expect#tohavereturnedtimesnumber)
- [ ] [`.toHaveReturnedWith()`](https://jestjs.io/docs/expect#tohavereturnedwithvalue)
- [ ] [`.toHaveLastReturnedWith()`](https://jestjs.io/docs/expect#tohavelastreturnedwithvalue)
- [ ] [`.toHaveNthReturnedWith()`](https://jestjs.io/docs/expect#tohaventhreturnedwithnthcall-value)
- [ ] [`.toBeCloseTo()`](https://jestjs.io/docs/expect#tobeclosetonumber-numdigits)
- [x] [`.toBeGreaterThan()`](https://jestjs.io/docs/expect#tobegreaterthannumber--bigint)
- [x] [`.toBeGreaterThanOrEqual()`](https://jestjs.io/docs/expect#tobegreaterthanorequalnumber--bigint)
- [x] [`.toBeLessThan()`](https://jestjs.io/docs/expect#tobelessthannumber--bigint)
- [x] [`.toBeLessThanOrEqual()`](https://jestjs.io/docs/expect#tobelessthanorequalnumber--bigint)
- [x] [`.toBeInstanceOf()`](https://jestjs.io/docs/expect#tobeinstanceofclass) (Bun v0.5.8+)
- [ ] [`.toContainEqual()`](https://jestjs.io/docs/expect#tocontainequalitem)
- [ ] [`.toMatch()`](https://jestjs.io/docs/expect#tomatchregexp--string)
- [ ] [`.toMatchObject()`](https://jestjs.io/docs/expect#tomatchobjectobject)
- [x] [`.toMatchSnapshot()`](https://jestjs.io/docs/expect#tomatchsnapshotpropertymatchers-hint) (Bun v0.5.8+)
- [ ] [`.toMatchInlineSnapshot()`](https://jestjs.io/docs/expect#tomatchinlinesnapshotpropertymatchers-inlinesnapshot)
- [ ] [`.toThrowErrorMatchingSnapshot()`](https://jestjs.io/docs/expect#tothrowerrormatchingsnapshothint)
- [ ] [`.toThrowErrorMatchingInlineSnapshot()`](https://jestjs.io/docs/expect#tothrowerrormatchinginlinesnapshotinlinesnapshot)

<!-- ```ts
test('matchers', ()=>{

  expect(5).toBe(5);
  expect("do re mi").toContain("mi");
  expect("do re mi").toEqual("do re mi");
  expect({}).toStrictEqual({}); // uses Bun.deepEquals()
  expect([1,2,3]).toHaveLength(3);
  expect({ name: "foo" }).toHaveProperty("name");
  expect({ name: "foo" }).toHaveProperty("name", "foo");
  expect(5).toBeTruthy();
  expect(0).toBeFalsy();
  expect("").toBeDefined();
  expect(undefined).toBeUndefined();
  expect(parseInt('tuna')).toBeNaN();
  expect(null).toBeNull();
  expect(5).toBeGreaterThan(4);
  expect(5).toBeGreaterThanOrEqual(5);
  expect(5).toBeLessThan(6);
  expect(5).toBeLessThanOrEqual(5);
  expect(()=>throw new Error()).toThrow();

  // negation
  expect(5).not.toBe(4)

})
``` -->
