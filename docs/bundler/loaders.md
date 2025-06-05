The Bun bundler implements a set of default loaders out of the box. As a rule of thumb, the bundler and the runtime both support the same set of file types out of the box.

`.js` `.cjs` `.mjs` `.mts` `.cts` `.ts` `.tsx` `.jsx` `.toml` `.json` `.txt` `.wasm` `.node` `.html`

Bun uses the file extension to determine which built-in _loader_ should be used to parse the file. Every loader has a name, such as `js`, `tsx`, or `json`. These names are used when building [plugins](https://bun.sh/docs/bundler/plugins) that extend Bun with custom loaders.

You can explicitly specify which loader to use using the 'loader' import attribute.

```ts
import my_toml from "./my_file" with { loader: "toml" };
```

## Built-in loaders

### `js`

**JavaScript**. Default for `.cjs` and `.mjs`.

Parses the code and applies a set of default transforms like dead-code elimination and tree shaking. Note that Bun does not attempt to down-convert syntax at the moment.

### `jsx`

**JavaScript + JSX.**. Default for `.js` and `.jsx`.

Same as the `js` loader, but JSX syntax is supported. By default, JSX is down-converted to plain JavaScript; the details of how this is done depends on the `jsx*` compiler options in your `tsconfig.json`. Refer to the TypeScript documentation [on JSX](https://www.typescriptlang.org/docs/handbook/jsx.html) for more information.

### `ts`

**TypeScript loader**. Default for `.ts`, `.mts`, and `.cts`.

Strips out all TypeScript syntax, then behaves identically to the `js` loader. Bun does not perform typechecking.

### `tsx`

**TypeScript + JSX loader**. Default for `.tsx`. Transpiles both TypeScript and JSX to vanilla JavaScript.

### `json`

**JSON loader**. Default for `.json`.

JSON files can be directly imported.

```ts
import pkg from "./package.json";
pkg.name; // => "my-package"
```

During bundling, the parsed JSON is inlined into the bundle as a JavaScript object.

```ts
var pkg = {
  name: "my-package",
  // ... other fields
};
pkg.name;
```

If a `.json` file is passed as an entrypoint to the bundler, it will be converted to a `.js` module that `export default`s the parsed object.

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

### `toml`

**TOML loader**. Default for `.toml`.

TOML files can be directly imported. Bun will parse them with its fast native TOML parser.

```ts
import config from "./bunfig.toml";
config.logLevel; // => "debug"

// via import attribute:
// import myCustomTOML from './my.config' with {type: "toml"};
```

During bundling, the parsed TOML is inlined into the bundle as a JavaScript object.

```ts
var config = {
  logLevel: "debug",
  // ...other fields
};
config.logLevel;
```

If a `.toml` file is passed as an entrypoint, it will be converted to a `.js` module that `export default`s the parsed object.

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

### `text`

**Text loader**. Default for `.txt`.

The contents of the text file are read and inlined into the bundle as a string.
Text files can be directly imported. The file is read and returned as a string.

```ts
import contents from "./file.txt";
console.log(contents); // => "Hello, world!"

// To import an html file as text
// The "type' attribute can be used to override the default loader.
import html from "./index.html" with { type: "text" };
```

When referenced during a build, the contents are into the bundle as a string.

```ts
var contents = `Hello, world!`;
console.log(contents);
```

If a `.txt` file is passed as an entrypoint, it will be converted to a `.js` module that `export default`s the file contents.

{% codetabs %}

```txt#Input
Hello, world!
```

```js#Output
export default "Hello, world!";
```

{% /codetabs %}

### `napi`

**Native addon loader**. Default for `.node`.

In the runtime, native addons can be directly imported.

```ts
import addon from "./addon.node";
console.log(addon);
```

In the bundler, `.node` files are handled using the [`file`](#file) loader.

### `sqlite`

**SQLite loader**. `with { "type": "sqlite" }` import attribute

In the runtime and bundler, SQLite databases can be directly imported. This will load the database using [`bun:sqlite`](https://bun.sh/docs/api/sqlite).

```ts
import db from "./my.db" with { type: "sqlite" };
```

This is only supported when the `target` is `bun`.

By default, the database is external to the bundle (so that you can potentially use a database loaded elsewhere), so the database file on-disk won't be bundled into the final output.

You can change this behavior with the `"embed"` attribute:

```ts
// embed the database into the bundle
import db from "./my.db" with { type: "sqlite", embed: "true" };
```

When using a [standalone executable](https://bun.sh/docs/bundler/executables), the database is embedded into the single-file executable.

Otherwise, the database to embed is copied into the `outdir` with a hashed filename.

### `html`

The html loader processes HTML files and bundles any referenced assets. It will:

- Bundle and hash referenced JavaScript files (`<script src="...">`)
- Bundle and hash referenced CSS files (`<link rel="stylesheet" href="...">`)
- Hash referenced images (`<img src="...">`)
- Preserve external URLs (by default, anything starting with `http://` or `https://`)

For example, given this HTML file:

{% codetabs %}

```html#src/index.html
<!DOCTYPE html>
<html>
  <body>
    <img src="./image.jpg" alt="Local image">
    <img src="https://example.com/image.jpg" alt="External image">
    <script type="module" src="./script.js"></script>
  </body>
</html>
```

{% /codetabs %}

It will output a new HTML file with the bundled assets:

{% codetabs %}

```html#dist/output.html
<!DOCTYPE html>
<html>
  <body>
    <img src="./image-HASHED.jpg" alt="Local image">
    <img src="https://example.com/image.jpg" alt="External image">
    <script type="module" src="./output-ALSO-HASHED.js"></script>
  </body>
</html>
```

{% /codetabs %}

Under the hood, it uses [`lol-html`](https://github.com/cloudflare/lol-html) to extract script and link tags as entrypoints, and other assets as external.

Currently, the list of selectors is:

- `audio[src]`
- `iframe[src]`
- `img[src]`
- `img[srcset]`
- `link:not([rel~='stylesheet']):not([rel~='modulepreload']):not([rel~='manifest']):not([rel~='icon']):not([rel~='apple-touch-icon'])[href]`
- `link[as='font'][href], link[type^='font/'][href]`
- `link[as='image'][href]`
- `link[as='style'][href]`
- `link[as='video'][href], link[as='audio'][href]`
- `link[as='worker'][href]`
- `link[rel='icon'][href], link[rel='apple-touch-icon'][href]`
- `link[rel='manifest'][href]`
- `link[rel='stylesheet'][href]`
- `script[src]`
- `source[src]`
- `source[srcset]`
- `video[poster]`
- `video[src]`

### `sh` loader

**Bun Shell loader**. Default for `.sh` files

This loader is used to parse [Bun Shell](https://bun.sh/docs/runtime/shell) scripts. It's only supported when starting Bun itself, so it's not available in the bundler or in the runtime.

```sh
$ bun run ./script.sh
```

### `file`

**File loader**. Default for all unrecognized file types.

The file loader resolves the import as a _path/URL_ to the imported file. It's commonly used for referencing media or font assets.

```ts#logo.ts
import logo from "./logo.svg";
console.log(logo);
```

_In the runtime_, Bun checks that the `logo.svg` file exists and converts it to an absolute path to the location of `logo.svg` on disk.

```bash
$ bun run logo.ts
/path/to/project/logo.svg
```

_In the bundler_, things are slightly different. The file is copied into `outdir` as-is, and the import is resolved as a relative path pointing to the copied file.

```ts#Output
var logo = "./logo.svg";
console.log(logo);
```

If a value is specified for `publicPath`, the import will use value as a prefix to construct an absolute path/URL.

{% table %}

- Public path
- Resolved import

---

- `""` (default)
- `/logo.svg`

---

- `"/assets"`
- `/assets/logo.svg`

---

- `"https://cdn.example.com/"`
- `https://cdn.example.com/logo.svg`

{% /table %}

{% callout %}
The location and file name of the copied file is determined by the value of [`naming.asset`](https://bun.sh/docs/bundler#naming).
{% /callout %}
This loader is copied into the `outdir` as-is. The name of the copied file is determined using the value of `naming.asset`.

{% details summary="Fixing TypeScript import errors" %}
If you're using TypeScript, you may get an error like this:

```ts
// TypeScript error
// Cannot find module './logo.svg' or its corresponding type declarations.
```

This can be fixed by creating `*.d.ts` file anywhere in your project (any name will work) with the following contents:

```ts
declare module "*.svg" {
  const content: string;
  export default content;
}
```

This tells TypeScript that any default imports from `.svg` should be treated as a string.
{% /details %}
