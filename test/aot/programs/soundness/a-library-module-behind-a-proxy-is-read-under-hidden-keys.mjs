// A proxy without traps wraps node:zlib, and its functions are called by dynamic keys.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const front = new Proxy(zlib, {});
console.log(front[hide("gunzipSync")](front[hide("gzipSync")]("hello")).toString());
