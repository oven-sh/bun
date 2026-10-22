function key(s) { return JSON.parse('"' + s + '"'); }
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const k = key("__proto__");
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("computed-obj", attempt(() => { t[k] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("computed-null", attempt(() => { t[k] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("computed-num", attempt(() => { t[k] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("constkey-obj", attempt(() => { t["__proto__"] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("constkey-null", attempt(() => { t["__proto__"] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("constkey-num", attempt(() => { t["__proto__"] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("dot-obj", attempt(() => { t.__proto__ = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("dot-null", attempt(() => { t.__proto__ = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("dot-num", attempt(() => { t.__proto__ = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("reflectset-obj", attempt(() => { Reflect.set(t, k, V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("reflectset-null", attempt(() => { Reflect.set(t, k, V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("reflectset-num", attempt(() => { Reflect.set(t, k, V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("reflectsetconst-obj", attempt(() => { Reflect.set(t, "__proto__", V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("reflectsetconst-null", attempt(() => { Reflect.set(t, "__proto__", V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("reflectsetconst-num", attempt(() => { Reflect.set(t, "__proto__", V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("define-obj", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("define-null", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("define-num", attempt(() => { Object.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("defineconst-obj", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("defineconst-null", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("defineconst-num", attempt(() => { Object.defineProperty(t, "__proto__", { value: V, writable: true, enumerable: true, configurable: true }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("assignparsed-obj", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}')); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("assignparsed-null", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}')); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("assignparsed-num", attempt(() => { Object.assign(t, JSON.parse('{"__proto__": {"c": "inherited"}}')); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("assigncomputed-obj", attempt(() => { Object.assign(t, { [k]: V }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("assigncomputed-null", attempt(() => { Object.assign(t, { [k]: V }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("assigncomputed-num", attempt(() => { Object.assign(t, { [k]: V }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("assignconst-obj", attempt(() => { Object.assign(t, { ["__proto__"]: V }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("assignconst-null", attempt(() => { Object.assign(t, { ["__proto__"]: V }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("assignconst-num", attempt(() => { Object.assign(t, { ["__proto__"]: V }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.bind(t)(V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("lookupsetter-obj", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("lookupsetter-null", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("lookupsetter-num", attempt(() => { t2 = {}; ({}).__lookupSetter__(k).bind(t)(V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("lookupsetterconst-obj", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("lookupsetterconst-null", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("lookupsetterconst-num", attempt(() => { ({}).__lookupSetter__("__proto__").bind(t)(V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("compound-obj", attempt(() => { t[k] ||= V; t[k] &&= V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("compound-null", attempt(() => { t[k] ||= V; t[k] &&= V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("compound-num", attempt(() => { t[k] ||= V; t[k] &&= V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("destructure-obj", attempt(() => { [t[k]] = [V]; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("destructure-null", attempt(() => { [t[k]] = [V]; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("destructure-num", attempt(() => { [t[k]] = [V]; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("destructureobj-obj", attempt(() => { ({ x: t[k] } = { x: V }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("destructureobj-null", attempt(() => { ({ x: t[k] } = { x: V }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("destructureobj-num", attempt(() => { ({ x: t[k] } = { x: V }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("forin-obj", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("forin-null", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("forin-num", attempt(() => { for (t[k] in { zz: 1 }) ; t[k] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("loopkeys-obj", attempt(() => { for (const n of [key("q"), k]) t[n] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("loopkeys-null", attempt(() => { for (const n of [key("q"), k]) t[n] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("loopkeys-num", attempt(() => { for (const n of [key("q"), k]) t[n] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("merge-obj", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}')); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("merge-null", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}')); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("merge-num", attempt(() => { (function merge(d, s) { for (const n in s) d[n] = s[n]; })(t, JSON.parse('{"__proto__": {"c": "inherited"}}')); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("definegetter-obj", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("definegetter-null", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("definegetter-num", attempt(() => { t.__defineGetter__ ? t.__defineGetter__(k, () => V) : 0; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("entries-obj", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("entries-null", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("entries-num", attempt(() => { for (const [n, v] of Object.entries({ q: 1, w: 2 })) t[n === "w" ? k : n] = V; return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("reflectdefine-obj", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("reflectdefine-null", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("reflectdefine-num", attempt(() => { Reflect.defineProperty(t, k, { value: V, writable: true, enumerable: true, configurable: true }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("fromentries-obj", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]])); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("fromentries-null", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]])); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("fromentries-num", attempt(() => { Object.assign(t, Object.fromEntries([[k, V]])); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("spreadparsed-obj", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("spreadparsed-null", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("spreadparsed-num", attempt(() => { Object.assign(t, { ...JSON.parse('{"__proto__": {"c": "inherited"}}') }); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = { m() { return "other.m"; }, c: "inherited", 5: "five", get g() { return "other.g"; }, s() { return "other.s"; }, length: 77 };
console.log("call-setter-obj", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = null;
console.log("call-setter-null", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
(() => {
let t2;
const t = /a/;
const V = 5;
console.log("call-setter-num", attempt(() => { Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(t, V); return "done"; }));
console.log(attempt(() => t.m()), attempt(() => t.g), attempt(() => t.c), attempt(() => t.a), attempt(() => t.n()), attempt(() => t.s()), attempt(() => typeof t.toString), attempt(() => typeof Q === "function" && t instanceof Q), attempt(() => typeof i0 === "object" ? i0.m() + i0.c : 0), attempt(() => typeof t.push), attempt(() => typeof t.call), attempt(() => typeof t.get), attempt(() => t[5]), attempt(() => typeof t.length));
})();
