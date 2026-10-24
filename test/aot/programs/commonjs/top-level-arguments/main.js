// `arguments` at the top level of a CommonJS module: the five values of the module wrapper.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
console.log("control: which mode this file is in: " + (function () { return this === undefined ? "strict" : "sloppy"; })());
console.log("straight in the body: " + typeof arguments + " " + arguments.length);
row("row 179", () => typeof arguments);
row("how many", () => arguments.length);
row("what it is", () => Object.prototype.toString.call(arguments));
row("exports", () => [arguments[0] === exports, arguments[0] === module.exports, arguments[0] === this].join());
row("module", () => [arguments[2] === module, arguments[2].exports === exports].join());
row("the two paths", () => [typeof arguments[3], typeof arguments[4], arguments[3].startsWith(arguments[4])].join());
row("beyond the five", () => [arguments[5], 5 in arguments, 4 in arguments].join());
row("its keys", () => Object.keys(arguments).join());
row("one object", () => [arguments === arguments, (() => arguments)() === arguments, (() => () => arguments)()() === arguments].join());
row("spread", () => [...arguments].length);
row("Array.from", () => Array.from(arguments).map((a, i) => i === 1 ? "-" : typeof a).join());
row("slice", () => Array.prototype.slice.call(arguments, 0, 1)[0] === exports);
row("handed on by apply", () => (function (e, r, m) { return [e === exports, m === module, arguments.length].join(); }).apply(this, arguments));
row("handed on by spread", () => ((e, r, m, ...rest) => [e === exports, m === module, rest.length].join())(...arguments));
row("a store through it is seen", () => { arguments[0].through = "seen"; return exports.through; });
row("a store to module.exports through it", () => { const before = module.exports; arguments[2].exports = { other: 1 }; const r = module.exports.other; module.exports = before; return r; });
row("control: a function's own", () => (function () { return arguments.length; })(1, 2));
row("control: an arrow in a function", () => (function () { return (() => arguments.length)(); })(1, 2, 3));
const lib = require("./files/lib.js");
row("in a module that is required", () => JSON.stringify(lib));
