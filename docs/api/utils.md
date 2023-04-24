## `Bun.sleep`

`Bun.sleep(ms: number)` (added in Bun v0.5.6)

Returns a `Promise` that resolves after the given number of milliseconds.

```ts
console.log("hello");
await Bun.sleep(1000);
console.log("hello one second later!");
```

Alternatively, pass a `Date` object to receive a `Promise` that resolves at that point in time.

```ts
const oneSecondInFuture = new Date(Date.now() + 1000);

console.log("hello");
await Bun.sleep(oneSecondInFuture);
console.log("hello one second later!");
```

## `Bun.which`

`Bun.which(bin: string)`

Find the path to an executable, similar to typing `which` in your terminal.

```ts
const ls = Bun.which("ls");
console.log(ls); // "/usr/bin/ls"
```

By default Bun looks at the current `PATH` environment variable to determine the path. To configure `PATH`:

```ts
const ls = Bun.which("ls", {
  PATH: "/usr/local/bin:/usr/bin:/bin",
});
console.log(ls); // "/usr/bin/ls"
```

Pass a `cwd` option to resolve for executable from within a specific directory.

```ts
const ls = Bun.which("ls", {
  cwd: "/tmp",
  PATH: "",
});

console.log(ls); // null
```

## `Bun.peek`

`Bun.peek(prom: Promise)` (added in Bun v0.2.2)

`Bun.peek` is a utility function that lets you read a promise's result without `await` or `.then`, but only if the promise has already fulfilled or rejected.

```ts
import { peek } from "bun";

const promise = Promise.resolve("hi");

// no await!
const result = peek(promise);
console.log(result); // "hi"
```

This is important when attempting to reduce number of extraneous microticks in performance-sensitive code. It's an advanced API and you probably shouldn't use it unless you know what you're doing.

```ts
import { peek } from "bun";
import { expect, test } from "bun:test";

test("peek", () => {
  const promise = Promise.resolve(true);

  // no await necessary!
  expect(peek(promise)).toBe(true);

  // if we peek again, it returns the same value
  const again = peek(promise);
  expect(again).toBe(true);

  // if we peek a non-promise, it returns the value
  const value = peek(42);
  expect(value).toBe(42);

  // if we peek a pending promise, it returns the promise again
  const pending = new Promise(() => {});
  expect(peek(pending)).toBe(pending);

  // If we peek a rejected promise, it:
  // - returns the error
  // - does not mark the promise as handled
  const rejected = Promise.reject(new Error("Successfully tested promise rejection"));
  expect(peek(rejected).message).toBe("Successfully tested promise rejection");
});
```

The `peek.status` function lets you read the status of a promise without resolving it.

```ts
import { peek } from "bun";
import { expect, test } from "bun:test";

test("peek.status", () => {
  const promise = Promise.resolve(true);
  expect(peek.status(promise)).toBe("fulfilled");

  const pending = new Promise(() => {});
  expect(peek.status(pending)).toBe("pending");

  const rejected = Promise.reject(new Error("oh nooo"));
  expect(peek.status(rejected)).toBe("rejected");
});
```

## `Bun.openInEditor`

Open a file in your default editor. Bun auto-detects your editor via the `$VISUAL` or `$EDITOR` environment variables.

```ts
const currentFile = import.meta.url;
Bun.openInEditor(currentFile);
```

You can override this via the `debug.editor` setting in your [`bunfig.toml`](/docs/runtime/configuration)

```toml-diff#bunfig.toml
+ [debug]
+ editor = "code"
```

Or specify an editor with the `editor` param. You can also specify a line and column number.

```ts
Bun.openInEditor(import.meta.url, {
  editor: "vscode", // or "subl"
  line: 10,
  column: 5,
});
```
