// Function evaluates the texts of functions of the file: what they make sees the global scope alone.
let hidden = process.argv.length > 0 ? 5 : 6; let counted = process.argv.length - process.argv.length; globalThis.seen = "global"; var outer = "of the file";
function adds(a, b) { return a + b; }
function reads() { return typeof hidden + typeof counted + typeof seen + typeof outer; }
const arrow = v => v * 2, method = { twice(v) { return v * 2; }, get asked() { return this.v; } }, unnamed = function (a, b = a * 2, ...rest) { return [a, b, rest.length].join(); };
function* steps(n) { for (let i = 0; i < n; i++) yield i; }
async function later(v) { return v + 1; }
class Box { constructor(v) { this.v = v; } get double() { return this.v * 2; } static of(v) { return new this(v); } }
const made = text => Function("return (" + text + ")")();
console.log(made(adds.toString())(2, 3), made(String(reads))(), reads(), made("" + arrow)(4), made(unnamed.toString())(1), made(`${unnamed}`)(1, 2, 3), made("{" + method.twice + "}").twice === undefined, typeof made("({" + method.twice + "}).twice"));
console.log([...made(steps.toString())(4)].join(), made(Box.toString()).of(3).double, made(Box + "") === Box, made(Box.toString()).name, made(adds.toString()).name, made(arrow.toString()).name, made(adds.toString()).toString() === adds.toString());
const bodies = ["return this === globalThis", "return typeof arguments + arguments.length", "'use strict'; return this === undefined", "return seen", "seen = 'written'; return seen", "var local = 3; return typeof globalThis.local", "return typeof hidden"];
for (const body of bodies) console.log(Function(body)(), new Function(body).call(undefined), typeof Function(body)); console.log(seen, typeof hidden, counted);
console.log(Function("a", "b", "return a - b")(5, 3), Function("a, b", "c", "return a + b + c")(1, 2, 3), Function("{ x }", "[y] = [4]", "return x + y")({ x: 1 }), Function("...all", "return all.length")(1, 2), Function().name, Function("a", "/* c */ return a").toString().length > 10);
for (const bad of ["return (", "}", "return hidden.x", "throw new RangeError('made')", "let a; let a;", "await 1"]) { try { console.log(typeof Function(bad)()); } catch (error) { console.log(error.constructor.name); } }
const loops = Function("f", "n", "let sum = 0; for (let i = 0; i < n; i++) sum += f(i); return sum"); console.log(loops(made(arrow.toString()), 100), loops(v => adds(v, hidden), 10), loops(method.twice, 3), loops(Number, 4)); made(later.toString())(1).then(v => console.log("later", v)); const eachTime = [1, 2, 3].map(k => Function("v", "return v + " + k)); console.log(eachTime.map(f => f(10)).join(), eachTime[0] === eachTime[1], (0, eval)("typeof hidden"), eval("typeof hidden"));
