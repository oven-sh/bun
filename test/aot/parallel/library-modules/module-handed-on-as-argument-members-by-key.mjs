// node:zlib goes through a value that the build cannot follow. Its members are then called under computed names.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const api = hide(zlib);
console.log(api[hide("brotliDecompressSync")](api[hide("brotliCompressSync")]("hello")).toString());
console.log(api[hide("inflateRawSync")](api[hide("deflateRawSync")]("raw")).toString());
