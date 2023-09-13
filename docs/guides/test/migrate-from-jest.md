---
name: Migrate from Jest to Bun's test runner
---

In many cases, Bun's test runner can run Jest test suites with no code changes.

- Bun internally re-writes imports from `@jest/globals` to use the `bun:test` equivalents.
- If you're relying on Jest to inject `test`, `expect`, etc. as globals, Bun does that too.

```sh-diff
- $ npx jest
+ $ bun test
```

---

Bun implements the vast majority of Jest's matchers, but compatibility isn't 100% yet. Refer to the full compatibility table at [Docs > Test runner > Writing tests](/docs/test/writing#matchers).

Some notable missing features:

- `expect.extend()`
- `expect().toMatchInlineSnapshot()`
- `expect().toHaveBeenCalledWith()`
- `expect().toHaveReturned()`

---

If you're using `testEnvironment` to run your tests in a browser-like environment, you'll need to register `jsdom` or `happy-dom` using Bun's `preload` feature. Follow the instructions in the [DOM testing with Bun and happy-dom](/guides/test/happy-dom) guide.

```toml#bunfig.toml
[test]
preload = ["./happy-dom.ts"]
```

---

Replace `bail` in your Jest config with the `--bail` CLI flag.

```ts-diff
- import type {Config} from 'jest';
-
- const config: Config = {
-   bail: 3
- };
```

```sh-diff
$ bun test --bail 3
```

---

Replace `collectCoverage` and `collectCoverageFrom` with the `--coverage` CLI flag.

```ts-diff
- import type {Config} from 'jest';
-
- const config: Config = {
-   collectCoverageFrom: [
-     '**/*.{js,jsx}',
-     '!**/node_modules/**',
-     '!**/vendor/**',
-   ],
- };
```

```sh
$ bun test --coverage
```

---

Many other flags become irrelevant or obsolete when using `bun test`.

- `extensionsToTreatAsEsm`
- `haste` — Bun uses it's own internal source maps
- `watchman` — use `--watch` to run tests in watch mode
- `verbose` — set `logLevel: "debug"` in [`bunfig.toml`](/docs/runtime/configuration.md#runtime)

---

Settings that aren't mentioned here are not supported or have no equivalent. Please [file a feature request](https://github.com/oven-sh/bun) if something important is missing.

---

See also:

- [Mark a test as a todo](/guides/test/todo-tests)
- [Docs > Test runner > Writing tests](/docs/test/writing)
