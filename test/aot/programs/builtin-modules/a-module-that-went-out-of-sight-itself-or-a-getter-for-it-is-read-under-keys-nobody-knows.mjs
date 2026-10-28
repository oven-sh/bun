import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const z0 = { get: () => zlib };
const z1 = { get: () => z0.get() };
const z2 = { get: () => z1.get() };
const z3 = { get: () => z2.get() };
const object = z3.get();
hide(process.argv.length > 5 ? z2 : object);
console.log(object[hide("gunzipSync")](object[hide("gzipSync")]("hello")).toString());
