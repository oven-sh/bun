// The arguments of a call are read, stored, deleted, lengthened and spread while parameters change, and lists change their length while they are spread or applied.
function show(f) { try { const v = f(); return typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + e.constructor.name; } }
const lines = [];
const sloppy = new Function("return [" + [
    "function (a, b) { arguments[0] = 'x'; b = 'y'; return [a, b, arguments[0], arguments[1], arguments.length]; }",
    "function (a, b) { delete arguments[0]; a = 'z'; arguments[0] = 'w'; return [a, arguments[0]]; }",
    "function (a, b) { arguments.length = 5; return [...arguments].length + ',' + Array.prototype.slice.call(arguments).length; }",
    "function (a, b) { Object.defineProperty(arguments, '0', { value: 'd', writable: false }); a = 'after'; return [a, arguments[0]]; }",
    "function (a, b) { Object.freeze(arguments); a = 'f'; return [a, arguments[0]]; }",
    "function (a, b) { const k = arguments; return (function () { return [k[0], k[5], k.length, arguments.length]; })(1, 2, 3); }",
    "function (a, b) { arguments[7] = 1; return [arguments.length, Object.keys(arguments).join()]; }",
    "function (a, b) { return [typeof arguments.callee, arguments[Symbol.iterator] === Array.prototype.values]; }",
    "function (a, b) { arguments[Symbol.iterator] = function* () { yield 'own'; }; return [...arguments]; }",
    "function (a, a2 = 1) { arguments[0] = 'q'; return [a, arguments[0]]; }",
    "function (a, ...r) { arguments[0] = 'q'; r.length = 0; return [a, arguments.length, r.length]; }",
    "function (a) { var arguments = [9]; return arguments; }",
    "function (a) { eval('a = 5; var b = arguments[0]'); return [a, b]; }",
].join() + "]")();
function compiledSloppy() { return [
    function (a, b) { "use strict"; arguments[0] = "x"; b = "y"; return [a, b, arguments[0], arguments[1], arguments.length]; },
    function (a, b) { const k = arguments; a = 1; return () => [k[0], k.length, k[9]]; },
    function () { return Array.from(arguments).concat(Array.prototype.slice.call(arguments, 1)); },
    function () { let t = 0; for (let i = 0; i < arguments.length + 2; i++) t += arguments[i] === undefined ? 100 : 1; return t; },
    function () { return Math.max.apply(null, arguments) + "," + Math.max(...arguments); },
    function () { arguments.length = 30000; return show(() => Math.max.apply(null, arguments)); },
    function () { arguments.length = -1; return show(() => [].concat.apply([], arguments).length); },
    function () { Object.setPrototypeOf(arguments, { 5: "inherited", length: 9 }); return [arguments[5], arguments.length, Array.prototype.slice.call(arguments).length]; },
]; }
for (const list of [sloppy, compiledSloppy()]) list.forEach((f, i) => { for (const args of [[], [1], [1, 2], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) lines.push(i + " " + args.length + " " + show(() => { const r = f(...args); return typeof r === "function" ? r() : r; })); });
function count() { return arguments.length; }
function sum(...r) { let t = 0; for (const v of r) t += v === undefined ? 1000 : v; return t + "/" + r.length; }
const shrinking = n => { const a = Array.from({ length: n }, (_, i) => i); Object.defineProperty(a, n >> 1, { get() { a.length = 1; return -1; }, configurable: true }); return a; };
const growing = n => { const a = Array.from({ length: n }, (_, i) => i); let once = true; a[Symbol.iterator] = function* () { for (let i = 0; i < a.length; i++) { if (once && i === 2) { once = false; for (let j = 0; j < 100; j++) a.push(j); } yield a[i]; } }; return a; };
const like = n => ({ get length() { return n; }, get 0() { return "zero"; }, 2: "two" });
for (const n of [4, 40, 400, 20000]) lines.push(n + " " + [show(() => sum(...shrinking(n))), show(() => sum.apply(null, shrinking(n))), show(() => count(...growing(n))), show(() => count.apply(null, like(n))), show(() => Reflect.apply(count, null, like(n))), show(() => new (function C() { this.n = arguments.length; })(...growing(n)).n),
    show(() => [...shrinking(n)].length), show(() => [0, ...growing(n), 1].length), show(() => Math.min(...shrinking(n))), show(() => String.fromCharCode.apply(null, shrinking(n)).length), show(() => [].push.apply([], shrinking(n))), show(() => count.bind(null, 1, 2).apply(null, shrinking(n))), show(() => count.call(...shrinking(n)))].join(" ; "));
lines.push(show(() => count.apply(null, { length: 2 ** 32 })), show(() => count.apply(null, { length: -1 })), show(() => count.apply(null, { length: "3" })), show(() => count.apply(null, 5)), show(() => count.apply(null, "abc")), show(() => count.apply(null, new Uint8Array(30000))), show(() => count(...new Uint8Array(30000))), show(() => count.apply(null, new Proxy([1, 2, 3], {}))), show(() => count(...new Set([1, 2]))), show(() => count(..."\u{1F600}a")));
{ const holes = [1, , 3]; holes.length = 6; lines.push(show(() => sum(...holes)), show(() => sum.apply(null, holes)), show(() => count(...[, ,]))); }
{ const b = new ArrayBuffer(16, { maxByteLength: 64 }); const u = new Uint8Array(b); lines.push(show(() => sum.apply({ valueOf() {} }, u)), show(() => { const it = u[Symbol.iterator](); it.next(); b.resize(0); return JSON.stringify(it.next()); }), show(() => count(...u))); }
console.log(lines.join("\n"));
