// With code splitting, esbuild exports its minified __require from a shared chunk and every other chunk imports it. `ng build` writes an Angular server this way, with the `inherits` package inside.
import { createRequire } from "node:module";
globalThis["require"] ??= createRequire(import.meta.url);
import { c as E, e as v } from "./chunk.mjs";
import { load } from "./reexport.mjs";

var browser = v((exports, module) => {
  module.exports = function () {
    throw new Error("the fallback for browsers ran");
  };
});
var inherits = v((exports, module) => {
  try {
    if (((util = E("util")), typeof util.inherits != "function")) throw "";
    module.exports = util.inherits;
  } catch {
    module.exports = browser();
  }
  var util;
});

function Child() {}
inherits()(Child, Error);
console.log(Child.super_ === Error);
console.log(E("zlib").gunzipSync(E("zlib").gzipSync("text")).toString());
console.log(E("string_decoder").StringDecoder.name, E("querystring").stringify({ a: 1 }), E("os").EOL === "\n");
console.log(load("node:dgram").createSocket("udp4").constructor.name);
