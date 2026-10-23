// `bun build --splitting --target=node` exports `__require = createRequire(import.meta.url)` from a shared chunk.
import { __require, metaRequire } from "./chunk.mjs";

console.log(__require("node:zlib").gunzipSync(__require("zlib").gzipSync("text")).toString());
console.log(metaRequire("node:querystring").stringify({ a: 1 }));
