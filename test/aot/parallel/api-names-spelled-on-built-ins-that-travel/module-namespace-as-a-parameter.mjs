import * as zlib from "node:zlib";
function use(z) {
  return z.gunzipSync(z.gzipSync("hello")).toString();
}
console.log(use(zlib));
