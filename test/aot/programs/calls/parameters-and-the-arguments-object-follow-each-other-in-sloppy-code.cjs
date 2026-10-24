// In sloppy code a parameter and its element of the arguments object are one variable until the element is deleted, redefined or frozen. Every way of parting them is tried, with fewer and more arguments than parameters.
function show(f) { try { const v = f(); return typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + e.constructor.name; } }
const list = [
    function (a, b) { arguments[0] = "x"; b = "y"; return [a, b, arguments[0], arguments[1], arguments.length]; },
    function (a, b) { delete arguments[0]; a = "z"; const was = arguments[0]; arguments[0] = "w"; return [a, was, arguments[0]]; },
    function (a, b) { arguments.length = 5; return [...arguments].length + "," + Array.prototype.slice.call(arguments).length; },
    function (a, b) { Object.defineProperty(arguments, "0", { value: "d", writable: false }); a = "after"; return [a, arguments[0]]; },
    function (a, b) { Object.defineProperty(arguments, "0", { get() { return "got"; }, configurable: true }); a = "after"; return [a, arguments[0]]; },
    function (a, b) { Object.defineProperty(arguments, "1", { value: "e" }); b = "still"; return [b, arguments[1]]; },
    function (a, b) { Object.defineProperty(arguments, "0", { enumerable: false }); a = "n"; return [a, arguments[0], Object.keys(arguments).join()]; },
    function (a, b) { Object.freeze(arguments); a = "f"; return [a, arguments[0], show(() => { arguments[0] = 1; return arguments[0]; })]; },
    function (a, b) { Object.seal(arguments); a = "s"; arguments[1] = "t"; return [a, b, arguments[0], arguments[1]]; },
    function (a, b) { Object.preventExtensions(arguments); arguments[5] = 1; b = "p"; return [arguments[5], arguments[1], b]; },
    function (a, b) { const k = arguments; return (function () { return [k[0], k[5], k.length, arguments.length]; })(1, 2, 3); },
    function (a, b) { const k = arguments; const set = v => { a = v; }; set("closure"); return [k[0], a]; },
    function (a, b) { const k = arguments; const get = () => a; k[0] = "element"; return [get(), a]; },
    function (a, b) { arguments[7] = 1; return [arguments.length, Object.keys(arguments).join()]; },
    function (a, b) { return [typeof arguments.callee, arguments[Symbol.iterator] === Array.prototype.values, Object.prototype.toString.call(arguments)]; },
    function (a, b) { arguments[Symbol.iterator] = function* () { yield "own"; }; return [...arguments]; },
    function (a, a2 = 1) { arguments[0] = "q"; return [a, arguments[0]]; },
    function (a, ...r) { arguments[0] = "q"; r.length = 0; return [a, arguments.length, r.length]; },
    function (a) { var arguments = [9]; return arguments; },
    function (a) { eval("a = 5; var b = arguments[0]"); return [a, b]; },
    function (a, b) { b = "late"; return [arguments[1], arguments.length, 1 in arguments]; },
    function (a, b) { arguments[1] = "late"; return [b, arguments.length, Object.keys(arguments).join()]; },
    function (a, b) { for (let i = 0; i < 3; i++) { arguments[i] = i * 2; } return [a, b, arguments[2], arguments.length]; },
    function (a, b) { let t = []; for (const k in arguments) t.push(k); delete arguments[1]; for (const k in arguments) t.push(k); b = 9; return t.concat([arguments[1], b]); },
    function (a, b) { Bun.gc(true); a = { big: [1, 2, 3] }; Bun.gc(true); return [arguments[0], JSON.stringify(arguments)]; },
    function (a, b) { const copy = Array.from(arguments); a = "changed"; return [copy[0], arguments[0]]; },
    function (a, b) { return (function inner(x) { x = "in"; return [arguments[0], inner.length]; }).apply(null, arguments); },
    function (a, b) { Object.setPrototypeOf(arguments, { 3: "inherited" }); a = 1; return [arguments[0], arguments[3], arguments.length]; },
    function (a, b) { delete arguments[0]; Object.defineProperty(arguments, "0", { value: "anew", writable: true, configurable: true, enumerable: true }); a = "apart"; return [a, arguments[0]]; },
    function (a, b) { arguments.length = 0; a = "k"; return [arguments[0], [...arguments].length]; },
    function (a, b) { const k = arguments; return function later() { a = "afterwards"; return [k[0], k.length]; }; },
];
const lines = [];
for (let round = 0; round < 2; round++) list.forEach((f, i) => { for (const args of [[], [1], [1, 2], [1, 2, 3], [1.5, "s", null, undefined, {}, [], 7, 8, 9, 10]]) lines.push(i + " " + args.length + " " + show(() => { const r = f(...args); return typeof r === "function" ? r() : r; })); });
console.log(lines.join("\n"));
