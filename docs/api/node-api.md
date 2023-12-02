Node-API is an interface for building native add-ons to Node.js. Bun implements 95% of this interface from scratch, so most existing Node-API extensions will work with Bun out of the box. Track the completion status of it in [this issue](https://github.com/oven-sh/bun/issues/158).

As in Node.js, `.node` files (Node-API modules) can be required directly in Bun.

```js
const napi = require("./my-node-module.node");
```

Alternatively, use `process.dlopen`:

```js
let mod = { exports: {} };
process.dlopen(mod, "./my-node-module.node");
```

Bun polyfills the [`detect-libc`](https://npmjs.com/package/detect-libc) package, which is used by many Node-API modules to detect which `.node` binding to `require`.
