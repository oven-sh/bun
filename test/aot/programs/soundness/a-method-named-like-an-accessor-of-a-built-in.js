const log = [];
function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
class Sized extends Map { size() { return "method"; } }
class Described extends Error { message() { return "method"; } }
class Listed extends Array { length2() {} }
class Buffered extends Uint8Array { byteLength() { return "method"; } }
class Flagged extends RegExp { flags() { return "method"; } }
function put(o, key, v) { o[key] = v; return typeof o[key] + ":" + Object.hasOwn(o, key); }
{ const o = new Sized(); o.size = 1; console.log(typeof o.size, Object.hasOwn(o, "size")); }
{ const o = new Map(); console.log(attempt(() => { "use strict"; o.size = 1; return o.size; })); }
{ const o = new Buffered(4); o.byteLength = 2; console.log(typeof o.byteLength, Object.hasOwn(o, "byteLength")); }
{ const o = new Flagged("a"); o.flags = "g"; console.log(typeof o.flags, Object.hasOwn(o, "flags")); }
{ const o = new Described("m"); o.message = "n"; console.log(o.message, Object.hasOwn(o, "message")); }
class Proto { __proto__() { return "method"; } }
{ const o = new Proto(); o.__proto__ = null; console.log(typeof o.__proto__, Object.hasOwn(o, "__proto__"), Object.getPrototypeOf(o) === Proto.prototype); }
