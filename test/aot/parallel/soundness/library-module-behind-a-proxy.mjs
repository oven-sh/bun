// The members of node:zlib are read through a Proxy under keys that only the run knows.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const front = new Proxy(zlib, {});
console.log(front[hide("gunzipSync")](front[hide("gzipSync")]("hello")).toString());
const trapped = new Proxy(zlib, { get: (target, key, receiver) => Reflect.get(target, key, receiver) });
console.log(trapped[hide("inflateSync")](trapped[hide("deflateSync")]("hello")).toString());
