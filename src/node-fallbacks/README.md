# Browser polyfills for `bun build --target=browser`

When using `bun build --target=browser`, if you attempt to import a Node.js module, Bun will load a polyfill for that module in an attempt to let your code still work even though it's not running in Node.js or a server.

For example, if you import `zlib`, the `node-fallbacks/zlib.js` file will be loaded.

## How they are built

`build-fallbacks.ts` bundles each file for the browser. A file that assigns `module.exports` is built as CommonJS, so that `require()` of it returns that value. Any other file is an ES module, and if it has no default export, the build adds one that has every named export. The npm packages read `process` and `Buffer` as globals, which a browser does not have: the build binds `Buffer` to the sibling polyfill, and `process` to the host's when there is a Node.js-like one and to the sibling polyfill when there is none.

## Not used by Bun's runtime

These files are _not_ used by Bun's runtime. They are only used for the `bun build --target=browser` command.

If you're interested in contributing to Bun's Node.js compatibility, please see the [`src/js` directory](https://github.com/oven-sh/bun/tree/main/src/js).
