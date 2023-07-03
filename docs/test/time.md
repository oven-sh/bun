`bun:test` lets you change what time it is in your tests. This was introduced in Bun v0.6.13.

This works with any of the following:

- `Date.now`
- `new Date()`
- `new Intl.DateTimeFormat().format()`

Timers are not impacted yet, but may be in a future release of Bun.

## `setSystemTime`

To change the system time, use `setSystemTime`:

```ts
import { setSystemTime, beforeAll } from "bun:test";

beforeAll(() => {
  setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
});

test("it is 2020", () => {
  expect(new Date().getFullYear()).toBe(2020);
});
```

To support existing tests that use Jest's `useFakeTimers` and `useRealTimers`, you can use `useFakeTimers` and `useRealTimers`:

```ts
test("just like in jest", () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
  expect(new Date().getFullYear()).toBe(2020);
  jest.useRealTimers();
  expect(new Date().getFullYear()).toBeGreaterThan(2020);
});
```

Note that we have not implemented builtin support for mocking timers yet, but this is on the roadmap.

### Reset the system time

To reset the system time, pass no arguments to `setSystemTime`:

```ts
import { setSystemTime, beforeAll } from "bun:test";

test("it was 2020, for a moment.", () => {
  // Set it to something!
  setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
  expect(new Date().getFullYear()).toBe(2020);

  // reset it!
  setSystemTime();

  expect(new Date().getFullYear()).toBeGreaterThan(2020);
});
```

## Set the time zone

To change the time zone, either pass the `$TZ` environment variable to your test runner, or set `process.env.TZ` at runtime:

```ts
import { test, expect } from "bun:test";

test("Welcome to California!", () => {
  process.env.TZ = "America/Los_Angeles";
  expect(new Date().getTimezoneOffset()).toBe(420);
  expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
    "America/Los_Angeles",
  );
});

test("Welcome to New York!", () => {
  process.env.TZ = "America/New_York";
  expect(new Date().getTimezoneOffset()).toBe(240);
  expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
    "America/New_York",
  );
});
```
