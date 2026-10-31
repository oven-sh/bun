// node:zlib is the prototype of a plain object and stands above the instances of a class. Both go through a value that the build cannot follow, and members of the module are called on them under computed names.
import * as zlib from "node:zlib";
const hide = value => new CustomEvent("x", { detail: value }).detail;
const below = hide(Object.create(zlib));
console.log(below[hide("gunzipSync")](below[hide("gzipSync")]("below an object")).toString());
class Api {}
Object.setPrototypeOf(Api.prototype, zlib);
const api = hide(new Api());
console.log(api[hide("inflateSync")](api[hide("deflateSync")]("below a class")).toString());
