Bun's test runner plays well with existing component and DOM testing libraries, including React Testing Library and [`happy-dom`](https://github.com/capricorn86/happy-dom).

## `happy-dom`

For writing headless tests for your frontend code and components, we recommend [`happy-dom`](https://github.com/capricorn86/happy-dom). Happy DOM implements a complete set of HTML and DOM APIs in plain JavaScript, making it possible to simulate a browser environment with high fidelity.

To get started install the `@happy-dom/global-registrator` package as a dev dependency.

```bash
$ bun add -d @happy-dom/global-registrator
```

We'll be using Bun's _preload_ functionality to register the `happy-dom` globals before running our tests. This step will make browser APIs like `document` available in the global scope. Create a file called `happydom.ts` in the root of your project and add the following code:

```ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
```

To preload this file before `bun test`, open or create a `bunfig.toml` file and add the following lines.

```toml
[test]
preload = "./happydom.ts"
```

This will execute `happydom.ts` when you run `bun test`. Now you can write tests that use browser APIs like `document` and `window`.

```ts#dom.test.ts
import {test, expect} from 'bun:test';

test('dom test', () => {
  document.body.innerHTML = `<button>My button</button>`;
  const button = document.querySelector('button');
  expect(button?.innerText).toEqual('My button');
});
```

Depending on your `tsconfig.json` setup, you may see a `"Cannot find name 'document'"` type error in the code above. To "inject" the types for `document` and other browser APIs, add the following [triple-slash directive](https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html) to the top of any test file.

```ts-diff#dom.test.ts
+ /// <reference lib="dom" />

  import {test, expect} from 'bun:test';

  test('dom test', () => {
    document.body.innerHTML = `<button>My button</button>`;
    const button = document.querySelector('button');
    expect(button?.innerText).toEqual('My button');
  });
```

Let's run this test with `bun test`:

```bash
$ bun test
bun test v1.x

dom.test.ts:
✓ dom test [0.82ms]

 1 pass
 0 fail
 1 expect() calls
Ran 1 tests across 1 files. 1 total [125.00ms]
```

<!-- ## React Testing Library

Once you've set up `happy-dom` as described above, you can use it with React Testing Library. To get started, install the `@testing-library/react` package as a dev dependency.

```bash
$ bun add -d @testing-library/react
``` -->
