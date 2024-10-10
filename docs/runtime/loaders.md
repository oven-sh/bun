## TypeScript

Bun natively supports TypeScript out of the box. All files are transpiled on the fly by Bun's fast native transpiler before being executed. Similar to other build tools, Bun does not perform typechecking; it simply removes type annotations from the file.

```bash
$ bun index.js
$ bun index.jsx
$ bun index.ts
$ bun index.tsx
```

Some aspects of Bun's runtime behavior are affected by the contents of your `tsconfig.json` file. Refer to [Runtime > TypeScript](https://bun.sh/docs/runtime/typescript) page for details.

## JSX

Bun supports `.jsx` and `.tsx` files out of the box. Bun's internal transpiler converts JSX syntax into vanilla JavaScript before execution.

```tsx#react.tsx
function Component(props: {message: string}) {
  return (
    <body>
      <h1 style={{color: 'red'}}>{props.message}</h1>
    </body>
  );
}

console.log(<Component message="Hello world!" />);
```

Bun implements special logging for JSX to make debugging easier.

```bash
$ bun run react.tsx
<Component message="Hello world!" />
```

## Text files

Text files can be imported as strings.

{% codetabs %}

```ts#index.ts
import text from "./text.txt";
console.log(text);
// => "Hello world!"
```

```txt#text.txt
Hello world!
```

{% /codetabs %}

## JSON and TOML

JSON and TOML files can be directly imported from a source file. The contents will be loaded and returned as a JavaScript object.

```ts
import pkg from "./package.json";
import data from "./data.toml";
```

## WASI

{% callout %}
🚧 **Experimental**
{% /callout %}

Bun has experimental support for WASI, the [WebAssembly System Interface](https://github.com/WebAssembly/WASI). To run a `.wasm` binary with Bun:

```bash
$ bun ./my-wasm-app.wasm
# if the filename doesn't end with ".wasm"
$ bun run ./my-wasm-app.whatever
```

{% callout %}

**Note** — WASI support is based on [wasi-js](https://github.com/sagemathinc/cowasm/tree/main/core/wasi-js). Currently, it only supports WASI binaries that use the `wasi_snapshot_preview1` or `wasi_unstable` APIs. Bun's implementation is not fully optimized for performance; this will become more of a priority as WASM grows in popularity.
{% /callout %}

## SQLite

You can import sqlite databases directly into your code. Bun will automatically load the database and return a `Database` object.

```ts
import db from "./my.db" with { type: "sqlite" };
console.log(db.query("select * from users LIMIT 1").get());
```

This uses [`bun:sqlite`](https://bun.sh/docs/api/sqlite).

## Custom loaders

Support for additional file types can be implemented with plugins. Refer to [Runtime > Plugins](https://bun.sh/docs/bundler/plugins) for full documentation.

<!--

A loader determines how to map imports &amp; file extensions to transforms and output.

Currently, Bun implements the following loaders:

| Input | Loader                        | Output |
| ----- | ----------------------------- | ------ |
| .js   | JSX + JavaScript              | .js    |
| .jsx  | JSX + JavaScript              | .js    |
| .ts   | TypeScript + JavaScript       | .js    |
| .tsx  | TypeScript + JSX + JavaScript | .js    |
| .mjs  | JavaScript                    | .js    |
| .cjs  | JavaScript                    | .js    |
| .mts  | TypeScript                    | .js    |
| .cts  | TypeScript                    | .js    |
| .toml | TOML                          | .js    |
| .css  | CSS                           | .css   |
| .env  | Env                           | N/A    |
| .\*   | file                          | string |

Everything else is treated as `file`. `file` replaces the import with a URL (or a path).

You can configure which loaders map to which extensions by passing `--loaders` to `bun`. For example:

```sh
$ bun --loader=.js:js
```

This will disable JSX transforms for `.js` files. -->
