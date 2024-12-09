---
name: Migrate from Jest to Bun's test runner
---

In many cases, Bun's test runner can run Jest test suites with no code changes. Just run `bun test` instead of `npx jest`, `yarn test`, etc.

```sh
- $ npx jest
- $ yarn test
+ $ bun test
```

---

There's often no need for code changes.

- Bun internally re-writes imports from `@jest/globals` to use the `bun:test` equivalents.
- If you're relying on Jest to inject `test`, `expect`, etc. as globals, Bun does that too.

But if you'd rather switch to the `bun:test` imports, you can do that too.

```ts-diff
- import {test, expect} from "@jest/globals";
+ import {test, expect} from "bun:test";
```

---

Bun implements the vast majority of Jest's matchers, but compatibility isn't 100% yet. Refer to the full compatibility table at [Docs > Test runner > Writing tests](https://bun.sh/docs/test/writing#matchers).

Some notable missing features:

- `expect().toHaveReturned()`

---

If you're using `testEnvironment: "jsdom"` to run your tests in a browser-like environment, you should follow the [DOM testing with Bun and happy-dom](/guides/test/happy-dom) guide to inject browser APIs into the global scope. This guide relies on [`happy-dom`](https://github.com/capricorn86/happy-dom), which is a leaner and faster alternative to [`jsdom`](https://github.com/jsdom/jsdom).

At the moment jsdom does not work in Bun due to its internal use of V8 APIs. Track support for it [here](https://github.com/oven-sh/bun/issues/3554).

```toml#bunfig.toml
[test]
preload = ["./happy-dom.ts"]
```

---

Replace `bail` in your Jest config with the `--bail` CLI flag.

<!-- ```ts-diff
- import type {Config} from 'jest';
-
- const config: Config = {
-   bail: 3
- };
``` -->

```sh
$ bun test --bail=3
```

---

Replace `collectCoverage` with the `--coverage` CLI flag.

<!-- ```ts-diff
- import type {Config} from 'jest';
-
- const config: Config = {
-   collectCoverageFrom: [
-     '**/*.{js,jsx}',
-     '!**/node_modules/**',
-     '!**/vendor/**',
-   ],
- };
``` -->

```sh
$ bun test --coverage
```

---

Replace `testTimeout` with the `--test-timeout` CLI flag.

```sh
$ bun test --timeout 10000
```

---

Many other flags become irrelevant or obsolete when using `bun test`.

- `transform` — Bun supports TypeScript & JSX. Other file types can be configured with [Plugins](https://bun.sh/docs/runtime/plugins).
- `extensionsToTreatAsEsm`
- `haste` — Bun uses it's own internal source maps
- `watchman`, `watchPlugins`, `watchPathIgnorePatterns` — use `--watch` to run tests in watch mode
- `verbose` — set `logLevel: "debug"` in [`bunfig.toml`](https://bun.sh/docs/runtime/bunfig#loglevel)

---

Settings that aren't mentioned here are not supported or have no equivalent. Please [file a feature request](https://github.com/oven-sh/bun) if something important is missing.

---

See also:

- [Mark a test as a todo](/guides/test/todo-tests)
- [Docs > Test runner > Writing tests](https://bun.sh/docs/test/writing)
