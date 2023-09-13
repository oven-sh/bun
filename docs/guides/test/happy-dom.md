---
name: Write browser DOM tests with Bun and happy-dom
---

You can write and run browser tests with Bun's test runner in conjunction with [Happy DOM](https://github.com/capricorn86/happy-dom). Happy DOM implements mocked versions of browser APIs like `document` and `location`.

---

To get started, install `happy-dom`.

```sh
$ bun add -d @happy-dom/global-registrator
```

---

This module exports a "registrator" that injects the mocked browser APIs to the global scope.

```ts#happydom.ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
```

---

We need to make sure this file is executed before any of our test files. That's a job for Bun's built-in [_preload_]() functionality. Create a `bunfig.toml` file in the root of your project (if it doesn't already exist) and add the following lines.

The `./happydom.ts` file should contain the registration code above.

```toml#bunfig.toml
[test]
preload = "./happydom.ts"
```

---

Now running `bun test` inside our project will automatically execute `happydom.ts` first. We can start writing tests that use browser APIs.

```ts
import { test, expect } from "bun:test";

test("set button text", () => {
  document.body.innerHTML = `<button>My button</button>`;
  const button = document.querySelector("button");
  expect(button?.innerText).toEqual("My button");
});
```

---

With Happy DOM properly configured, this test runs as expected.

```sh
$ bun test

dom.test.ts:
✓ set button text [0.82ms]

 1 pass
 0 fail
 1 expect() calls
Ran 1 tests across 1 files. 1 total [125.00ms]
```

---

Refer to the [Happy DOM repo](https://github.com/capricorn86/happy-dom) and [Docs > Test runner > DOM](/docs/test/dom) for complete documentation on writing browser tests with Bun.
