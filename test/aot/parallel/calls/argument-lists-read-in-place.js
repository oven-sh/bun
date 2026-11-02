var out = [];
function restThenArguments(a, ...r) { r[0] = 9; return arguments[1]; }
out.push(restThenArguments(1, 2));
function restPushed(a, ...r) { r.push(7); return arguments.length + ":" + arguments[2]; }
out.push(restPushed(1, 2));
var shared = [1, 2, 3];
function mutatesShared() { shared[0] = 9; return arguments[0]; }
out.push(mutatesShared.apply(null, shared)); shared[0] = 1;
out.push(mutatesShared(...shared)); shared[0] = 1;
function lengthOfShared() { shared.length = 0; return arguments.length; }
out.push(lengthOfShared(...shared)); shared = [1, 2, 3];
function sum() { var t = 0; for (var i = 0; i < arguments.length; i++) t += arguments[i]; return t; }
out.push(sum(...[1.5, 2.5]), sum(...[1, , 3]), sum.apply(null, [1, , 3]), sum.apply(null, { length: 2, 0: 4, 1: 5 }), sum.apply(null), sum.apply(null, null));
out.push(Math.max.apply(Math, [1, "7", 3]), Math.max.apply(null, []), Math.max(...[1, , 3]), Math.max.apply(Math, { length: 2, 0: 4, 1: 9 }), Math.min(...[2, 1.5]));
function maxOfArguments() { return Math.max.apply(Math, arguments); }
out.push(maxOfArguments(), maxOfArguments(1, 5, 2), maxOfArguments("3", { valueOf: function () { return 8; } }));
var order = [];
function v(n) { return { valueOf: function () { order.push(n); return n; } }; }
out.push(Math.max(...[v(1), v(3), v(2)]), order.join(""));
function toArray(list, from) { return Array.prototype.slice.call(list, from || 0); }
function sliced(a, b) { return toArray(arguments, 1).join(","); }
out.push(sliced(), sliced(1), sliced(1, 2), sliced(1, 2, 3, 4));
function slicedThenWritten(a) { var copy = toArray(arguments); copy[0] = 5; return arguments[0] + ":" + copy[0]; }
out.push(slicedThenWritten(1));
function forwardThenRead() { var r = sum.apply(null, arguments); return r + arguments[0]; }
out.push(forwardThenRead(1, 2));
function calleeWrites() { arguments[0] = 100; return arguments[0]; }
function forwardToWriter() { var r = calleeWrites.apply(null, arguments); return r + ":" + arguments[0]; }
out.push(forwardToWriter(1, 2));
function C(a, b) { this.s = a + b; }
out.push(new C(...[1, 2]).s);
class Base { constructor(a, b) { this.t = a * b; } }
class Derived extends Base { constructor(...args) { super(...args); args[0] = 0; } }
out.push(new Derived(3, 4).t);
var f = function () { return 1; };
f.apply = function () { return 2; };
out.push(f.apply(null, []));
var g = function () { return this === undefined ? "u" : typeof this; };
out.push(g.call(), g.call(5), g.apply(null, []), g.call("s"));
function strict() { "use strict"; return this === undefined ? "u" : typeof this; }
out.push(strict.call(), strict.call(5), strict.apply(null, []));
Object.setPrototypeOf(strict, null);
out.push(typeof strict.call);
var slice = Array.prototype.slice;
out.push(slice.length, slice.name, Math.max.length, typeof slice.prototype, slice.hasOwnProperty("call"), Object.getOwnPropertyNames(Math.max).sort().join());
out.push(1 + undefined, [1 + "a", 2 + null, 3 + true].join(), (function (x) { return 1 + x; })({ valueOf: function () { return 4; } }), (function (x) { return 2 < x; })("3"), (function (x) { return 1 + x; })(1n === 1n ? "z" : 0));
function spreadInto(f, list) { return f(...list); }
function describe(a, b, c) { return [a, b, c, arguments.length].join(); }
function construct(F, list) { return new F(...list); }
function Triple(a, b, c) { this.text = [a, b, c, arguments.length].join(); }
var holey = [1, , 3];
var doubles = JSON.parse("[1.5,2.5]");
var empty = new Array(2);
var withGetter = [1, 2];
Object.defineProperty(withGetter, 0, { get: function () { return 40; } });
var withIterator = [1, 2];
withIterator[Symbol.iterator] = function* () { yield 9; };
class Listed extends Array { *[Symbol.iterator]() { yield 7; yield 8; } }
var frozen = Object.freeze([4, 5]);
var lists = [holey, doubles, empty, withGetter, withIterator, Listed.from([1]), frozen, "ab", new Set([6]), [], [[1], { a: 1 }.a]];
for (var round = 0; round < 3; round++) {
  for (var at = 0; at < lists.length; at++) {
    out.push(spreadInto(describe, lists[at]), spreadInto(sum, lists[at]), construct(Triple, lists[at]).text, spreadInto(Math.max, lists[at]), describe.apply(null, typeof lists[at] === "string" ? [] : lists[at]));
  }
}
function growsWhileCalled(list) { return spreadInto(function (a) { list.push(a); list[0] = "w"; return arguments.length + ":" + arguments[0]; }, list); }
out.push(growsWhileCalled([1, 2]));
try { spreadInto(describe, null); } catch (error) { out.push(error instanceof TypeError); }
try { spreadInto(describe, 5); } catch (error) { out.push(error instanceof TypeError); }
try { describe.apply(null, 5); } catch (error) { out.push(error instanceof TypeError); }
console.log(out.join(" | "));
