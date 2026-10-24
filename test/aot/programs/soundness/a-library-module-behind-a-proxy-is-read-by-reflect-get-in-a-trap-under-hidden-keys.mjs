// A proxy wraps node:zlib, its get trap calls Reflect.get(), and the functions are called by dynamic keys.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const front = new Proxy(zlib, {
  get(target, key, receiver) {
    return Reflect.get(target, key, receiver);
  },
});
console.log(front[hide("gunzipSync")](front[hide("gzipSync")]("hello")).toString());
