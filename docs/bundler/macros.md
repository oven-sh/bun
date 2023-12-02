Macros are a mechanism for running JavaScript functions _at bundle-time_. The value returned from these functions are directly inlined into your bundle.

<!-- embed the result in your (browser) bundle. This is useful for things like embedding the current Git commit hash in your code, making fetch requests to your API at build-time, dead code elimination, and more. -->

As a toy example, consider this simple function that returns a random number.

```ts
export function random() {
  return Math.random();
}
```

This is just a regular function in a regular file, but we can use it as a macro like so:

```ts#cli.tsx
import { random } from './random.ts' with { type: 'macro' };

console.log(`Your random number is ${random()}`);
```

{% callout %}
**Note** — Macros are indicated using [_import attribute_](https://github.com/tc39/proposal-import-attributes) syntax. If you haven't seen this syntax before, it's a Stage 3 TC39 proposal that lets you attach additional metadata to `import` statements.
{% /callout %}

Now we'll bundle this file with `bun build`. The bundled file will be printed to stdout.

```bash
$ bun build ./cli.tsx
console.log(`Your random number is ${0.6805550949689833}`);
```

As you can see, the source code of the `random` function occurs nowhere in the bundle. Instead, it is executed _during bundling_ and function call (`random()`) is replaced with the result of the function. Since the source code will never be included in the bundle, macros can safely perform privileged operations like reading from a database.

## When to use macros

If you have several build scripts for small things where you would otherwise have a one-off build script, bundle-time code execution can be easier to maintain. It lives with the rest of your code, it runs with the rest of the build, it is automatically parallelized, and if it fails, the build fails too.

If you find yourself running a lot of code at bundle-time though, consider running a server instead.

## Import attributes

Bun Macros are import statements annotated using either:

- `with { type: 'macro' }` — an [import attribute](https://github.com/tc39/proposal-import-attributes), a Stage 3 ECMA Scrd
- `assert { type: 'macro' }` — an import assertion, an earlier incarnation of import attributes that has now been abandoned (but is [already supported](https://caniuse.com/mdn-javascript_statements_import_import_assertions) by a number of browsers and runtimes)

## Security considerations

Macros must explicitly be imported with `{ type: "macro" }` in order to be executed at bundle-time. These imports have no effect if they are not called, unlike regular JavaScript imports which may have side effects.

You can disable macros entirely by passing the `--no-macros` flag to Bun. It produces a build error like this:

```js
error: Macros are disabled

foo();
^
./hello.js:3:1 53
```

To reduce the potential attack surface for malicious packages, macros cannot be _invoked_ from inside `node_modules/**/*`. If a package attempts to invoke a macro, you'll see an error like this:

```js
error: For security reasons, macros cannot be run from node_modules.

beEvil();
^
node_modules/evil/index.js:3:1 50
```

Your application code can still import macros from `node_modules` and invoke them.

```ts
import {macro} from "some-package" with { type: "macro" };

macro();
```

## Export condition `"macro"`

When shipping a library containing a macro to `npm` or another package registry, use the `"macro"` [export condition](https://nodejs.org/api/packages.html#conditional-exports) to provide a special version of your package exclusively for the macro environment.

```jsonc#package.json
{
  "name": "my-package",
  "exports": {
    "import": "./index.js",
    "require": "./index.js",
    "default": "./index.js",
    "macro": "./index.macro.js"
  }
}
```

With this configuration, users can consume your package at runtime or at bundle-time using the same import specifier:

```ts
import pkg from "my-package";                            // runtime import
import {macro} from "my-package" with { type: "macro" }; // macro import
```

The first import will resolve to `./node_modules/my-package/index.js`, while the second will be resolved by Bun's bundler to `./node_modules/my-package/index.macro.js`.

## Execution

When Bun's transpiler sees a macro import, it calls the function inside the transpiler using Bun's JavaScript runtime and converts the return value from JavaScript into an AST node. These JavaScript functions are called at bundle-time, not runtime.

Macros are executed synchronously in the transpiler during the visiting phase—before plugins and before the transpiler generates the AST. They are executed in the order they are imported. The transpiler will wait for the macro to finish executing before continuing. The transpiler will also `await` any `Promise` returned by a macro.

Bun's bundler is multi-threaded. As such, macros execute in parallel inside of multiple spawned JavaScript "workers".

## Dead code elimination

The bundler performs dead code elimination _after_ running and inlining macros. So given the following macro:

```ts#returnFalse.ts
export function returnFalse() {
  return false;
}
```

...then bundling the following file will produce an empty bundle.

```ts
import {returnFalse} from './returnFalse.ts' with { type: 'macro' };

if (returnFalse()) {
  console.log("This code is eliminated");
}
```

## Serializability

Bun's transpiler needs to be able to serialize the result of the macro so it can be inlined into the AST. All JSON-compatible data structures are supported:

```ts#macro.ts
export function getObject() {
  return {
    foo: "bar",
    baz: 123,
    array: [ 1, 2, { nested: "value" }],
  };
}
```

Macros can be async, or return `Promise` instances. Bun's transpiler will automatically `await` the `Promise` and inline the result.

```ts#macro.ts
export async function getText() {
  return "async value";
}
```

The transpiler implements special logic for serializing common data formats like `Response`, `Blob`, `TypedArray`.

- `TypedArray`: Resolves to a base64-encoded string.
- `Response`: Bun will read the `Content-Type` and serialize accordingly; for instance, a `Response` with type `application/json` will be automatically parsed into an object and `text/plain` will be inlined as a string. Responses with an unrecognized or `undefined` `type` will be base-64 encoded.
- `Blob`: As with `Response`, the serialization depends on the `type` property.

The result of `fetch` is `Promise<Response>`, so it can be directly returned.

```ts#macro.ts
export function getObject() {
  return fetch("https://bun.sh")
}
```

Functions and instances of most classes (except those mentioned above) are not serializable.

```ts
export function getText(url: string) {
  // this doesn't work!
  return () => {};
}
```

## Arguments

Macros can accept inputs, but only in limited cases. The value must be statically known. For example, the following is not allowed:

```ts
import {getText} from './getText.ts' with { type: 'macro' };

export function howLong() {
  // the value of `foo` cannot be statically known
  const foo = Math.random() ? "foo" : "bar";

  const text = getText(`https://example.com/${foo}`);
  console.log("The page is ", text.length, " characters long");
}
```

However, if the value of `foo` is known at bundle-time (say, if it's a constant or the result of another macro) then it's allowed:

```ts
import {getText} from './getText.ts' with { type: 'macro' };
import {getFoo} from './getFoo.ts' with { type: 'macro' };

export function howLong() {
  // this works because getFoo() is statically known
  const foo = getFoo();
  const text = getText(`https://example.com/${foo}`);
  console.log("The page is", text.length, "characters long");
}
```

This outputs:

```ts
function howLong() {
  console.log("The page is", 1322, "characters long");
}
export { howLong };
```

## Examples

### Embed latest git commit hash

{% codetabs %}

```ts#getGitCommitHash.ts
export function getGitCommitHash() {
  const {stdout} = Bun.spawnSync({
    cmd: ["git", "rev-parse", "HEAD"],
    stdout: "pipe",
  });

  return stdout.toString();
}
```

{% /codetabs %}

<!-- --target=browser so they can clearly see it's for browsers -->

When we build it, the `getGitCommitHash` is replaced with the result of calling the function:

{% codetabs %}

```ts#input
import { getGitCommitHash } from './getGitCommitHash.ts' with { type: 'macro' };

console.log(`The current Git commit hash is ${getGitCommitHash()}`);
```

```bash#output
console.log(`The current Git commit hash is 3ee3259104f`);
```

{% /codetabs %}

You're probably thinking "Why not just use `process.env.GIT_COMMIT_HASH`?" Well, you can do that too. But can you do this with an environment variable?

### Make `fetch()` requests at bundle-time

In this example, we make an outgoing HTTP request using `fetch()`, parse the HTML response using `HTMLRewriter`, and return an object containing the title and meta tags–all at bundle-time.

```ts
export async function extractMetaTags(url: string) {
  const response = await fetch(url);
  const meta = {
    title: "",
  };
  new HTMLRewriter()
    .on("title", {
      text(element) {
        meta.title += element.text;
      },
    })
    .on("meta", {
      element(element) {
        const name =
          element.getAttribute("name") || element.getAttribute("property") || element.getAttribute("itemprop");

        if (name) meta[name] = element.getAttribute("content");
      },
    })
    .transform(response);

  return meta;
}
```

<!-- --target=browser so they can clearly see it's for browsers -->

The `extractMetaTags` function is erased at bundle-time and replaced with the result of the function call. This means that the `fetch` request happens at bundle-time, and the result is embedded in the bundle. Also, the branch throwing the error is eliminated since it's unreachable.

{% codetabs %}

```ts#input
import { extractMetaTags } from './meta.ts' with { type: 'macro' };

export const Head = () => {
  const headTags = extractMetaTags("https://example.com");

  if (headTags.title !== "Example Domain") {
    throw new Error("Expected title to be 'Example Domain'");
  }

  return <head>
    <title>{headTags.title}</title>
    <meta name="viewport" content={headTags.viewport} />
  </head>;
};
```

```ts#output
import { jsx, jsxs } from "react/jsx-runtime";
export const Head = () => {
  jsxs("head", {
    children: [
      jsx("title", {
        children: "Example Domain",
      }),
      jsx("meta", {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      }),
    ],
  });
};

export { Head };
```

{% /codetabs %}
