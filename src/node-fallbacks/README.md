# Browser polyfills for `bun build --target=browser`

When using `bun build --target=browser`, if you attempt to import a Node.js module, Bun will load a polyfill for that module in an attempt to let your code still work even though it's not running in Node.js or a server.

For example, if you import `zlib`, the `node-fallbacks/zlib.js` file will be loaded.

## How they are built

`build-fallbacks.ts` bundles each file for the browser. A file that assigns `module.exports` is built as CommonJS, so that `require()` of it returns that value. Any other file is an ES module, and if it has no default export, the build adds one that has every named export. The npm packages read `process` and `Buffer` as globals, which a browser does not have: the build binds `Buffer` to the sibling polyfill, and `process` to the host's when there is a Node.js-like one and to the sibling polyfill when there is none.

## Names of top-level bindings

A page can load a bundle as a classic script, and a content script of a browser extension is always one. A classic script declares its top-level `var`, `function` and `class` names on the global object, before it runs. So a top-level binding of an ES module polyfill that has the name of a global does one of these:

- It replaces the global. `export const browser = true` replaced the extension API of a content script.
- It hides a global that the host inherits. In a content script of Firefox, `var URL = globalThis.URL` first declares a `URL` that is `undefined`, and then reads that one.
- It declares a global on a host that does not have it.

So no top-level binding has the name of a global of a page, a worker or an extension. To export such a name, bind the value under another name and write `export { local as name }`. The test `browser/NodePolyfillsDeclareNoPageGlobal` checks the names that the bundle of each polyfill declares.

## Not used by Bun's runtime

These files are _not_ used by Bun's runtime. They are only used for the `bun build --target=browser` command.

If you're interested in contributing to Bun's Node.js compatibility, please see the [`src/js` directory](https://github.com/oven-sh/bun/tree/main/src/js).
