// Error.isError() of every kind of value, in loops, conditions, filters, by value, with no, several and spread arguments.
import vm from "node:vm";
class Mine extends Error { x = 1; } class Type extends TypeError {} class Deep extends Mine { constructor(m) { super(m); this.code = 2; } }
function Old(m) { this.message = m; } Old.prototype = Object.create(Error.prototype);
const values = { undef: undefined, nul: null, yes: true, no: false, int: 5, dbl: 1.5, nan: NaN, big: 5n, text: "t", empty: "", symbol: Symbol("s"), fn: () => 1, cls: Error, obj: {}, like: { name: "Error", message: "m", stack: "s" }, arr: [1], date: new Date(0), regexp: /a/, map: new Map(), set: new Set(), promise: Promise.resolve(1), view: new Uint8Array(1), boxed: Object(5), gen: (function* () {})(),
  err: new Error("e"), bare: new Error(), called: Error("c"), type: new TypeError("t"), range: new RangeError("r"), syntax: new SyntaxError("s"), uri: new URIError("u"), evil: new EvalError("v"), ref: new ReferenceError("f"), agg: new AggregateError([new Error("a")], "g"), cause: new Error("m", { cause: 1 }), mine: new Mine("m"), deep: new Deep("d"), typed: new Type("y"), old: new Old("o"),
  proxy: new Proxy(new Error("p"), {}), heir: Object.create(new Error("h")), proto: Error.prototype, protoType: TypeError.prototype, below: Object.create(Error.prototype), changed: Object.setPrototypeOf(new Error("x"), null), plainBelow: Object.setPrototypeOf({}, Error.prototype), frozen: Object.freeze(new Error("z")), sealed: Object.seal(new Mine("w")), dom: new DOMException("m", "AbortError"), other: vm.runInNewContext("new TypeError('r')"), otherMine: vm.runInNewContext("class K extends Error {} new K('r')"), otherObject: vm.runInNewContext("({})"), thrown: (() => { try { null.x; } catch (e) { return e; } })(), reflected: Reflect.construct(Error, ["q"], Map), reflectedMap: Reflect.construct(Map, [], Error), exotic: structuredClone(new RangeError("k")) };
const list = Object.entries(values);
function asked(v) { return Error.isError(v); }
function branch(v) { if (Error.isError(v)) return v.message.length; return -1; }
function both(v) { return !Error.isError(v) || v instanceof TypeError ? "a" : "b"; }
function typed(/** @type {Error} */ v) { return Error.isError(v) ? v.message.length : 0; }
function text(/** @type {string} */ v) { return Error.isError(v) ? 1 : 0; }
function message(v) { return Error.isError(v) ? v.message : v instanceof Error ? v.message + "?" : typeof v === "string" ? v : ""; }
function toError(v) { return Error.isError(v) ? v : new Error(String(typeof v)); }
for (let turn = 0; turn < 4; turn++) {
  let t = "";
  for (const [n, v] of list) t += n + asked(v) + (n === "changed" || n === "reflected" ? "" : branch(v)) + both(v) + message(v) + (n === "changed" || n === "reflected" ? "" : toError(v).message) + " ";
  console.log(t);
  let r = 0; for (let i = 0; i < list.length; i++) { const v = list[i][1]; if (Error.isError(v)) r += i; else r -= 1; }
  console.log(r, list.filter(([, v]) => Error.isError(v)).length, list.map(e => e[1]).filter(Error.isError).length, list.findIndex(([, v]) => Error.isError(v)), typed(new Mine("abc")), text("t"));
}
console.log(Error.isError(), Error.isError(1, new Error("a")), Error.isError(new Error("a"), 2), Error.isError(...[new Error("a")]), Error.isError(...[]), Error.isError.call(null, new Error("a")), Error.isError.apply(5, [new Mine("a")]), Error["is" + "Error"](new Type("a")), Error.isError.name, Error.isError.length);
const { isError } = Error; console.log(isError(new Error("a")), isError({}), [1, new Error("a")].map(isError).join(), TypeError.isError === Error.isError, TypeError.isError(new Error("a")), Mine.isError(new Mine("a")), Mine.isError({}));
let order = ""; console.log(Error.isError((order += "a", new Error("a")), (order += "b", 1)), order);
console.log(Error.isError?.(new Error("a")), Error?.isError({}), typeof Error.isError(5), !!Error.isError(values.mine) + 1);
