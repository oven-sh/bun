// `const m = require(..)` at the top level of a module is read before and after the declaration has run.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
const lines = [];
function viaFunction() { return m.x; }
lines.push("ahead of everything: " + said(() => m.x) + " " + said(viaFunction));
{ const m = require("./files/a"); lines.push("the first block: " + m.x); }
lines.push("between: " + said(() => m.x) + " " + said(viaFunction) + " " + said(() => typeof m));
const m = require("./files/b");
lines.push("behind the declaration: " + m.x + " " + viaFunction());
{ const m = require("./files/a"); lines.push("a block behind: " + m.x); { const m = { x: "innermost" }; lines.push("a let in it: " + m.x); } lines.push("the block again: " + m.x); }
lines.push("behind that: " + m.x);
lines.push("from an arrow with a block: " + (() => { { const m = require("./files/a"); } return m.x; })());
lines.push("from a function with a parameter: " + (function (m) { { const m = require("./files/a"); } return m; })("parameter"));
lines.push("identity: " + ((() => { { const m = require("./files/a"); } return m; })() === require("./files/b")));
if (m) { const m = require("./files/a"); lines.push("in an if: " + m.x); }
for (const m of [require("./files/a")]) lines.push("in a for-of: " + m.x);
try { throw 0; } catch { const m = require("./files/a"); lines.push("in a catch: " + m.x); }
lines.push("at the end: " + m.x);
{ const k = require("./files/a"); lines.push("another name, in a block: " + k.x); }
lines.push("that name outside: " + typeof k);
var v = { x: "var" };
{ const v = require("./files/a"); lines.push("a var of the file around: " + v.x); }
lines.push("the var: " + v.x);
function fn() {} fn.x = "function";
{ const fn = require("./files/a"); lines.push("a function of the file around: " + fn.x); }
lines.push("the function: " + fn.x);
class cl { static x = "class"; }
{ const cl = require("./files/a"); lines.push("a class of the file around: " + cl.x); }
lines.push("the class: " + cl.x);
let lt = { x: "let" };
{ const lt = require("./files/a"); lines.push("a let of the file around: " + lt.x); }
lines.push("the let: " + lt.x);
for (const line of lines) console.log(line);
