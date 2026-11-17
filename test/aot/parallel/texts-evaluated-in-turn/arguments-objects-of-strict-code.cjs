const { fullGC, edenGC } = require("bun:jsc");
globalThis.collect = () => void fullGC(); globalThis.collectYoung = () => void edenGC();
const text = `
"use strict";
const lines = [], kept = [];
const show = v => typeof v === "function" ? "F" : v && typeof v === "object" ? JSON.stringify(v) + Object.prototype.toString.call(v) : Object.is(v, -0) ? "-0" : String(v);
const attempt = f => { try { lines.push(show(f())); } catch (e) { lines.push(e.name); } };
const functions = [
    function () { return arguments; },
    function (a, b, c) { a = "changed"; return [arguments.length, arguments[0], a, arguments[1], c]; },
    function (a) { arguments[0] = "stored"; arguments[7] = "far"; return [a, arguments.length, Object.keys(arguments).join()]; },
    function () { arguments.length = 2; return Array.from(arguments); },
    function () { return Array.prototype.slice.call(arguments, 1); },
    function () { return [...arguments].reverse(); },
    function () { delete arguments[0]; return [0 in arguments, arguments.length, arguments[0]]; },
    function () { return arguments.callee; },
    function () { let n = 0; for (const x of arguments) n += x === undefined ? 100 : 1; for (const k in arguments) n += +k; return n; },
    function () { return inner.apply(this, arguments); },
    function () { kept.push(arguments); return kept.length; },
    function () { Object.defineProperty(arguments, 0, { get() { return "getter"; }, configurable: true }); return [arguments[0], arguments.length]; },
    function () { Object.freeze(arguments); try { arguments[0] = 1; } catch (e) { return e.name; } return "stored"; },
    function () { arguments.added = 1; arguments.b = 2; arguments.c = 3; arguments.d = 4; arguments.e = 5; return Object.getOwnPropertyNames(arguments).join(); },
    function () { return (() => arguments.length + show(arguments[0]))(); },
    function (...rest) { return [rest.length, arguments.length, rest[0] === arguments[0]]; },
    function () { return Object.getPrototypeOf(arguments) === Object.prototype && Object.prototype.hasOwnProperty.call(arguments, "length") && !Object.prototype.propertyIsEnumerable.call(arguments, "length"); },
];
function inner() { return arguments.length + ":" + Array.prototype.join.call(arguments, "|"); }
const values = [1, -0, 2.5, "s", undefined, null, true, {}, [1], () => 1, NaN, 10n, "t", 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (let t = 0; t < 6; t++) {
    for (const f of functions) for (let n = 0; n < 22; n += n < 6 ? 1 : 5) {
        const list = values.slice(0, n).map(v => typeof v === "bigint" ? "big" : v);
        attempt(() => f(...list));
        attempt(() => f.apply({ self: 1 }, list));
        attempt(() => f.call(undefined));
        attempt(() => new f(1, 2));
    }
    if (t === 2) collect();
    if (t === 4) collectYoung();
}
for (const a of kept) lines.push(a.length + ":" + Array.prototype.map.call(a, show).join());
lines.length + " " + lines.reduce((h, l) => { for (let k = 0; k < l.length; k++) h = (Math.imul(h, 31) + l.charCodeAt(k)) | 0; return h; }, 0) + "\\n" + lines.slice(0, 2000).join("\\n");
`;
for (let t = 0; t < 2; t++) console.log((0, eval)(text + "//" + t));
