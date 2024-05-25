---
name: Define and replace static globals & constants
---

The `--define` flag lets you declare statically-analyzable constants and globals. It replace all usages of an identifier or property in a JavaScript or TypeScript file with a constant value. This feature is supported at runtime and also in `bun build`. This is sort of similar to `#define` in C/C++, except for JavaScript.

```ts
bun --define:process.env.NODE_ENV="'production'" src/index.ts # Runtime
bun build --define:process.env.NODE_ENV="'production'" src/index.ts # Build
```

---

These statically-known values are used by Bun for dead code elimination and other optimizations.

```ts
if (process.env.NODE_ENV === "production") {
  console.log("Production mode");
} else {
  console.log("Development mode");
}
```

---

Before the code reaches the JavaScript engine, Bun replaces `process.env.NODE_ENV` with `"production"`.

```ts
if ("production" === "production") {
  console.log("Production mode");
} else {
  console.log("Development mode");
}
```

---

It doesn't stop there. Bun's optimizing transpiler is smart enough to do some basic constant folding.

Since `"production" === "production"` is always `true`, Bun replaces the entire expression with the `true` value.

```ts
if (true) {
  console.log("Production mode");
} else {
  console.log("Development mode");
}
```

---

And finally, Bun detects the `else` branch is not reachable, and eliminates it.

```ts
console.log("Production mode");
```

---

## What types of values are supported?

Values can be strings, identifiers, properties, or JSON.

### Replace global identifiers

To make all usages of `window` be `undefined`, you can use the following command.

```sh
bun --define window="undefined" src/index.ts
```

This can be useful when Server-Side Rendering (SSR) or when you want to make sure that the code doesn't depend on the `window` object.

```js
if (typeof window !== "undefined") {
  console.log("Client-side code");
} else {
  console.log("Server-side code");
}
```

You can also set the value to be another identifier. For example, to make all usages of `global` be `globalThis`, you can use the following command.

```sh
bun --define global="globalThis" src/index.ts
```

`global` is a global object in Node.js, but not in web browsers. So, you can use this to fix some cases where the code assumes that `global` is available.

### Replace values with JSON

`--define` can also be used to replace values with JSON objects and arrays.

To replace all usages of `AWS` with the JSON object `{"ACCESS_KEY":"abc","SECRET_KEY":"def"}`, you can use the following command.

```sh
# JSON
bun --define:AWS='{"ACCESS_KEY":"abc","SECRET_KEY":"def"}' src/index.ts
```

Those will be transformed into the equivalent JavaScript code.

From:

```ts
console.log(AWS.ACCESS_KEY); // => "abc"
```

To:

```ts
console.log("abc");
```

### Replace values with other properties

You can also pass properties to the `--define` flag.

For example, to replace all usages of `console.write` with `console.log`, you can use the following command (requires Bun v1.1.5 or later)

```sh
bun --define:console.write=console.log src/index.ts
```

That transforms the following input:

```ts
console.write("Hello, world!");
```

Into the following output:

```ts
console.log("Hello, world!");
```

## How is this different than setting a variable?

You can also set `process.env.NODE_ENV` to `"production"` in your code, but that won't help with dead code elimination. In JavaScript, property accesses can have side effects. Getters & setters can be functions, and even dynamically defined (due to prototype chains and Proxy). Even if you set `process.env.NODE_ENV` to `"production"`, on the next line, it is not safe for static analysis tools to assume that `process.env.NODE_ENV`is`"production"`.

## How is this different than find-and-replace or string replacement?

The `--define` flag operates on the AST (Abstract Syntax Tree) level, not on the text level. It happens during the transpilation process, which means it can be used in optimizations like dead code elimination.

String replacement tools tend to have escaping issues and replace unintended parts of the code.
