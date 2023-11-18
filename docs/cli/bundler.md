Bundling is currently an important mechanism for building complex web apps.

Modern apps typically consist of a large number of files and package dependencies. Despite the fact that modern browsers support [ES Module](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) imports, it's still too slow to fetch each file via individual HTTP requests. _Bundling_ is the process of concatenating several source files into a single large file that can be loaded in a single request.

{% callout %}
**On bundling** — Despite recent advances like [`modulepreload`](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/modulepreload) and [HTTP/3](https://en.wikipedia.org/wiki/HTTP/3), bundling is still the most performant approach.
{% /callout %}

## Bundling your app

Bun's approach to bundling is a little different from other bundlers. Start by passing your app's entrypoint to `bun bun`.

```bash
$ bun bun ./app.js
```

Your entrypoint can be any `js|jsx|ts|tsx|html` file. With this file as a starting point, Bun will construct a graph of imported files and packages, transpile everything, and generate a file called `node_modules.bun`.

## What is `.bun`?

{% callout %}
**Note** — [This format may change soon](https://github.com/oven-sh/bun/issues/121)
{% /callout %}

A `.bun` file contains the pre-transpiled source code of your application, plus a bunch of binary-encoded metadata about your application's structure. as a contains:

- all the bundled source code
- all the bundled source code metadata
- project metadata & configuration

Here are some of the questions `.bun` files answer:

- when I import `react/index.js`, where in the `.bun` is the code for that? (not resolving, just the code)
- what modules of a package are used?
- what framework is used? (e.g., Next.js)
- where is the routes directory?
- how big is each imported dependency?
- what is the hash of the bundle’s contents? (for etags)
- what is the name & version of every npm package exported in this bundle?
- what modules from which packages are used in this project? ("project" is defined as all the entry points used to generate the .bun)

All in one file.

It’s a little like a build cache, but designed for reuse across builds.

{% details summary="Position-independent code" %}

From a design perspective, the most important part of the `.bun` format is how code is organized. Each module is exported by a hash like this:

```js
// preact/dist/preact.module.js
export var $eb6819b = $$m({
  "preact/dist/preact.module.js": (module, exports) => {
    let n, l, u, i, t, o, r, f, e = {}, c = [], s = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
    // ... rest of code
```

This makes bundled modules [position-independent](https://en.wikipedia.org/wiki/Position-independent_code). In theory, one could import only the exact modules in-use without reparsing code and without generating a new bundle. One bundle can dynamically become many bundles comprising only the modules in use on the webpage. Thanks to the metadata with the byte offsets, a web server can send each module to browsers [zero-copy](https://en.wikipedia.org/wiki/Zero-copy) using [sendfile](https://man7.org/linux/man-pages/man2/sendfile.2.html). Bun itself is not quite this smart yet, but these optimizations would be useful in production and potentially very useful for React Server Components.

To see the schema inside, have a look at [`JavascriptBundleContainer`](./src/api/schema.d.ts#:~:text=export%20interface-,JavascriptBundleContainer,-%7B). You can find JavaScript bindings to read the metadata in [src/api/schema.js](./src/api/schema.js). This is not really an API yet. It’s missing the part where it gets the binary data from the bottom of the file. Someday, I want this to be usable by other tools too.
{% /details %}

## Where is the code?

`.bun` files are marked as executable.

To print out the code, run `./node_modules.bun` in your terminal or run `bun ./path-to-node_modules.bun`.

Here is a copy-pastable example:

```bash
$ ./node_modules.bun > node_modules.js
```

This works because every `.bun` file starts with this:

```
#!/usr/bin/env bun
```

To deploy to production with Bun, you’ll want to get the code from the `.bun` file and stick that somewhere your web server can find it (or if you’re using Vercel or a Rails app, in a `public` folder).

Note that `.bun` is a binary file format, so just opening it in VSCode or vim might render strangely.

## Advanced

By default, `bun bun` only bundles external dependencies that are `import`ed or `require`d in either app code or another external dependency. An "external dependency" is defined as, "A JavaScript-like file that has `/node_modules/` in the resolved file path and a corresponding `package.json`".

To force Bun to bundle packages which are not located in a `node_modules` folder (i.e., the final, resolved path following all symlinks), add a `bun` section to the root project’s `package.json` with `alwaysBundle` set to an array of package names to always bundle. Here’s an example:

```json
{
  "name": "my-package-name-in-here",
  "bun": {
    "alwaysBundle": ["@mybigcompany/my-workspace-package"]
  }
}
```

Bundled dependencies are not eligible for Hot Module Reloading. The code is served to browsers & Bun.js verbatim. But, in the future, it may be sectioned off into only parts of the bundle being used. That’s possible in the current version of the `.bun` file (so long as you know which files are necessary), but it’s not implemented yet. Longer-term, it will include all `import` and `export` of each module inside.

## What is the module ID hash?

The `$eb6819b` hash used here:

```js
export var $eb6819b = $$m({
```

Is generated like this:

1. Murmur3 32-bit hash of `package.name@package.version`. This is the hash uniquely identifying the npm package.
2. Wyhash 64 of the `package.hash` + `package_path`. `package_path` means "relative to the root of the npm package, where is the module imported?". For example, if you imported `react/jsx-dev-runtime.js`, the `package_path` is `jsx-dev-runtime.js`. `react-dom/cjs/react-dom.development.js` would be `cjs/react-dom.development.js`
3. Truncate the hash generated above to a `u32`

The implementation details of this module ID hash will vary between versions of Bun. The important part is the metadata contains the module IDs, the package paths, and the package hashes, so it shouldn’t really matter in practice if other tooling wants to make use of any of this.
