// esbuild puts this __require in every ES module bundle that contains a CommonJS require() of a built-in module.
var __require = /* @__PURE__ */ (x =>
  typeof require !== "undefined"
    ? require
    : typeof Proxy !== "undefined"
      ? new Proxy(x, {
          get: (a, b) => (typeof require !== "undefined" ? require : a)[b],
        })
      : x)(function (x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

function Child() {}
__require("util").inherits(Child, Error);
console.log(Child.super_ === Error);
const zlib = __require("zlib");
console.log(zlib.gunzipSync(__require("node:zlib").gzipSync("text")).toString());
console.log(__require(process.argv.length > 99 ? "node:dgram" : "node:querystring").stringify({ a: 1 }));
console.log(typeof __require.resolve, __require("path") === __require("node:path"));
