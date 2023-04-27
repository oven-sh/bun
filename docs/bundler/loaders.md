The Bun bundler implements a set of default loaders out of the box. As a rule of thumb, the bundler and the runtime both support the same set of file types out of the box.

`.js` `.cjs` `.mjs` `.mts` `.cts` `.ts` `.tsx` `.jsx` `.toml` `.json`

{% callout %}
The runtime also supports `.wasm` and `.node` binaries, which are not easily embedded in a bundle. These are effectively not supported by Bun's bundler.
{% /callout %}

This document describes how these extensions map onto Bun's set of built-in _loaders_. Every loader has a name, such as `js`, `tsx`, or `json`. These names are used when building [plugins](/docs/bundler/plugins) that extend Bun with custom loaders.

{% table %}

- Loader
- Extensions
- Description

---

- `js`
- `.cjs` `.mjs`
- **JavaScript.** Parses the code and applies a set if default transforms, like dead-code elimination, tree shaking, and environment variable inlining. Note that Bun does not attempt to down-convert syntax at the moment.

---

- `jsx`
- `.js` `.jsx`
- **JavaScript + JSX.** Same as the `js` loader, but JSX syntax is supported. By default, JSX is downconverted to `createElement` syntax and a `jsx` factory is injected into the bundle. This can be configured using the relevant `jsx*` compiler options in `tsconfig.json`.

---

- `ts`
- `.mts` `.cts`
- **TypeScript.** Strips out all TypeScript syntax, then behaves identically to the `js` loader. Bun does not perform typechecking.

---

- `tsx`
- `.ts` `.tsx`
- **TypeScript + JSX**. Transpiles both TypeScript and JSX to vanilla JavaScript.

---

- `json`
- `.json`
- **JSON**. JSON files are parsed and inlined into the bundle as a JavaScript object.

  ```ts
  import pkg from "./package.json";
  pkg.name; // => "my-package"
  ```

  If a `.json` file is passed as an entrypoint, it will be converted to a `.js` with the parsed object as a default export.

  {% codetabs %}

  ```json#Input
  {
    "name": "John Doe",
    "age": 35,
    "email": "johndoe@example.com"
  }
  ```

  ```js#Output
  export default {
    name: "John Doe",
    age: 35,
    email: "johndoe@example.com"
  }
  ```

  {% /codetabs %}

---

- `toml`
- `.toml`
- **TOML**. TOML files are parsed and inlined into the bundle as a JavaScript object.

  ```ts
  import config from "./bunfig.toml";
  config.logLevel; // => "debug"
  ```

  If a `.toml` file is passed as an entrypoint, it will be converted to a `.js` with the parsed object as a default export.

  {% codetabs %}

  ```toml#Input
  name = "John Doe"
  age = 35
  email = "johndoe@example.com"
  ```

  ```js#Output
  export default {
    name: "John Doe",
    age: 35,
    email: "johndoe@example.com"
  }
  ```

  {% /codetabs %}

---

- `text`
- `.txt`
- **Text files**. The contents of the text file are read and inlined into the bundle as a string.

  ```ts
  import contents from "./file.txt";
  console.log(contents); // => "Hello, world!"
  ```

  If a `.txt` file is passed as an entrypoint, it will be converted to a `.js` with the contents of the file as a default export.

  {% codetabs %}

  ```txt#Input
  Hello, world!
  ```

  ```js#Output
  export default "Hello, world!";
  ```

  {% /codetabs %}

---

- `file`
- `.*`
- **File loader**. Any unrecognized file type is handled using the `file` loader. The file is copied into the `outdir` as-is. The name of the copied file is determined using the value of `naming.asset`.

{% /table %}
