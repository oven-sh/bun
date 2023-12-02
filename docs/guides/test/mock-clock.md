---
name: Set the system time in Bun's test runner
---

Bun's test runner supports setting the system time programmatically with the `setSystemTime` function.

```ts
import { test, expect, setSystemTime } from "bun:test";

test("party like it's 1999", () => {
  const date = new Date("1999-01-01T00:00:00.000Z");
  setSystemTime(date); // it's now January 1, 1999

  const now = new Date();
  expect(now.getFullYear()).toBe(1999);
  expect(now.getMonth()).toBe(0);
  expect(now.getDate()).toBe(1);
});
```

---

The `setSystemTime` function is commonly used on conjunction with [Lifecycle Hooks](/docs/test/lifecycle) to configure a testing environment with a deterministic "fake clock".

```ts
import { test, expect, beforeAll, setSystemTime } from "bun:test";

beforeAll(() => {
  const date = new Date("1999-01-01T00:00:00.000Z");
  setSystemTime(date); // it's now January 1, 1999
});

// tests...
```

---

To reset the system clock to the actual time, call `setSystemTime` with no arguments.

```ts
import { test, expect, beforeAll, setSystemTime } from "bun:test";

setSystemTime(); // reset to actual time
```

---

See [Docs > Test Runner > Date and time](/docs/test/time) for complete documentation on mocking with the Bun test runner.
