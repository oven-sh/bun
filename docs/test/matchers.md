Bun's `expect` API ships with a set of built-in matchers similar to Jest. Each matcher is implemented in `expect.zig`.

## Basic usage

```ts#basic.test.ts
import { expect, test } from "bun:test";

test("sum", () => {
  expect(2 + 2).toBe(4);
});
```

## Matchers

### `.toBe()`

Checks strict equality.

```ts
expect(2 + 2).toBe(4);
```

```ts
toBe(expected: T): void;
```

### `.toEqual()`

Compares values recursively.

```ts
expect({ a: 1 }).toEqual({ a: 1 });
```

```ts
toEqual(expected: T): void;
```

### `.toBeNull()`

Asserts that a value is `null`.

```ts
expect(null).toBeNull();
```

```ts
toBeNull(): void;
```

### `.toBeUndefined()`

Asserts that a value is `undefined`.

```ts
expect(undefined).toBeUndefined();
```

```ts
toBeUndefined(): void;
```

### `.toBeNaN()`

Asserts that a value is `NaN`.

```ts
expect(Number.NaN).toBeNaN();
```

```ts
toBeNaN(): void;
```

### `.toBeDefined()`

Checks that a value is not `undefined`.

```ts
expect(5).toBeDefined();
```

```ts
toBeDefined(): void;
```

### `.toBeFalsy()`

Checks that a value is falsy.

```ts
expect(0).toBeFalsy();
```

```ts
toBeFalsy(): void;
```

### `.toBeTruthy()`

Checks that a value is truthy.

```ts
expect(1).toBeTruthy();
```

```ts
toBeTruthy(): void;
```

### `.toContain()`

Asserts that an array or string contains a value.

```ts
expect([1, 2, 3]).toContain(2);
```

```ts
toContain(expected: unknown): void;
```

### `.toHaveLength()`

Checks the `.length` property of a value.

```ts
expect([1, 2]).toHaveLength(2);
```

```ts
toHaveLength(length: number): void;
```

### `.toHaveProperty()`

Verifies that an object has a property.

```ts
expect({ a: { b: 1 } }).toHaveProperty("a.b", 1);
```

```ts
toHaveProperty(keyPath: string | number | Array<string | number>, value?: unknown): void;
```

### `.toHaveBeenCalled()`

Asserts that a mock function was called.

```ts
const fn = vi.fn();
fn();
expect(fn).toHaveBeenCalled();
```

```ts
toHaveBeenCalled(): void;
```

### `.toHaveBeenCalledTimes()`

Checks how many times a mock function was called.

```ts
const fn = vi.fn();
fn();
expect(fn).toHaveBeenCalledTimes(1);
```

```ts
toHaveBeenCalledTimes(expected: number): void;
```

### `.toHaveBeenCalledWith()`

Ensures a mock function was called with specific arguments.

```ts
const fn = vi.fn();
fn(1, 2);
expect(fn).toHaveBeenCalledWith(1, 2);
```

```ts
toHaveBeenCalledWith(...expected: unknown[]): void;
```

### `.toThrow()`

Expects a function to throw.

```ts
expect(() => {
  throw new Error("oops");
}).toThrow();
```

```ts
toThrow(expected?: unknown): void;
```

### `.toHaveReturned()`

Asserts that a mock function returned at least once.

```ts
const fn = vi.fn(() => 1);
fn();
expect(fn).toHaveReturned();
```

```ts
toHaveReturned(): void;
```

### `.toHaveReturnedTimes()`

Checks how many times a mock function returned.

```ts
const fn = vi.fn(() => 1);
fn();
expect(fn).toHaveReturnedTimes(1);
```

```ts
toHaveReturnedTimes(times: number): void;
```

### `.toBeGreaterThan()`

Asserts that a number is greater than another.

```ts
expect(10).toBeGreaterThan(5);
```

```ts
toBeGreaterThan(expected: number | bigint): void;
```

### `.toBeLessThan()`

Asserts that a number is less than another.

```ts
expect(5).toBeLessThan(10);
```

```ts
toBeLessThan(expected: number | bigint): void;
```

### `.toBeCloseTo()`

Checks that a number is close to another within a precision.

```ts
expect(0.2 + 0.1).toBeCloseTo(0.3, 5);
```

```ts
toBeCloseTo(expected: number, numDigits?: number): void;
```

### `.toBeGreaterThanOrEqual()`

Asserts that a number is greater than or equal to another.

```ts
expect(5).toBeGreaterThanOrEqual(4);
```

```ts
toBeGreaterThanOrEqual(expected: number | bigint): void;
```

### `.toBeLessThanOrEqual()`

Asserts that a number is less than or equal to another.

```ts
expect(4).toBeLessThanOrEqual(5);
```

```ts
toBeLessThanOrEqual(expected: number | bigint): void;
```

### `.toBeOdd()`

Asserts that a number is odd.

```ts
expect(3).toBeOdd();
```

```ts
toBeOdd(): void;
```

### `.toBeEven()`

Asserts that a number is even.

```ts
expect(2).toBeEven();
```

```ts
toBeEven(): void;
```

### `.toBeWithin()`

Checks that a number falls within a range.

```ts
expect(5).toBeWithin(0, 10);
```

```ts
toBeWithin(start: number, end: number): void;
```

### `.toBeEmpty()`

Asserts that a value is empty.

```ts
expect([]).toBeEmpty();
```

```ts
toBeEmpty(): void;
```

### `.toBeEmptyObject()`

Checks that an object has no own properties.

```ts
expect({}).toBeEmptyObject();
```

```ts
toBeEmptyObject(): void;
```

### `.toBeNil()`

Asserts that a value is `null` or `undefined`.

```ts
expect(undefined).toBeNil();
```

```ts
toBeNil(): void;
```

### `.toBeArray()`

Checks that a value is an array.

```ts
expect([1, 2]).toBeArray();
```

```ts
toBeArray(): void;
```

### `.toBeArrayOfSize()`

Asserts that an array has a specific length.

```ts
expect([1]).toBeArrayOfSize(1);
```

```ts
toBeArrayOfSize(size: number): void;
```

### `.toBeBoolean()`

Asserts that a value is a boolean.

```ts
expect(true).toBeBoolean();
```

```ts
toBeBoolean(): void;
```

### `.toBeTypeOf()`

Checks a value's type string.

```ts
expect(1).toBeTypeOf("number");
```

```ts
toBeTypeOf(type: "bigint" | "boolean" | "function" | "number" | "object" | "string" | "symbol" | "undefined"): void;
```

### `.toBeTrue()`

Asserts that a value is `true`.

```ts
expect(true).toBeTrue();
```

```ts
toBeTrue(): void;
```

### `.toBeFalse()`

Asserts that a value is `false`.

```ts
expect(false).toBeFalse();
```

```ts
toBeFalse(): void;
```

### `.toBeNumber()`

Checks that a value is a number.

```ts
expect(1).toBeNumber();
```

```ts
toBeNumber(): void;
```

### `.toBeInteger()`

Asserts that a number is an integer.

```ts
expect(1).toBeInteger();
```

```ts
toBeInteger(): void;
```

### `.toBeObject()`

Checks that a value is an object.

```ts
expect({}).toBeObject();
```

```ts
toBeObject(): void;
```

### `.toBeFinite()`

Asserts that a number is finite.

```ts
expect(2).toBeFinite();
```

```ts
toBeFinite(): void;
```

### `.toBePositive()`

Checks that a number is positive.

```ts
expect(1).toBePositive();
```

```ts
toBePositive(): void;
```

### `.toBeNegative()`

Checks that a number is negative.

```ts
expect(-1).toBeNegative();
```

```ts
toBeNegative(): void;
```
