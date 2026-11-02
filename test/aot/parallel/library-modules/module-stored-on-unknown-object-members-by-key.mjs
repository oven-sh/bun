// node:zlib is stored on an object that the build cannot follow, under a name and under a computed key, and read back from it. Its members are then called under computed names.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const box = hide({});
box.named = zlib;
box[hide("computed")] = zlib;
const named = hide(box).named;
console.log(named[hide("zstdDecompressSync")](named[hide("zstdCompressSync")]("named")).toString());
const computed = hide(box)[hide("computed")];
console.log(computed[hide("unzipSync")](computed[hide("deflateSync")]("computed")).toString());
