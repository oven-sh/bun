# Browser polyfills for `bun build --target=browser`

When using `bun build --target=browser`, if you attempt to import a Node.js module, Bun will load a polyfill for that module in an attempt to let your code still work even though it's not running in Node.js or a server.

For example, if you import `zlib`, the `node-fallbacks/zlib.js` file will be loaded.

## Not used by Bun's runtime

These files are _not_ used by Bun's runtime. They are only used for the `bun build --target=browser` command.

If you're interested in contributing to Bun's Node.js compatibility, please see the [`src/js` directory](https://github.com/oven-sh/bun/tree/main/src/js).
