// The callee comes by a parameter, a field, a list, a capture and a result, in and outside of loops, and each call passes another kind of value.
function one(x) { return x + 1; }
function two(x) { return x + 2; }
function three(x, y) { return [x, y, arguments.length].join("|"); }
function four(x, y = "default") { return [x, y].join("|"); }
function five(...all) { return all.length + ":" + all.join("|"); }
function six() { return typeof this + ":" + (this === undefined ? "none" : this.name); }
function seven() { "use strict"; return this === undefined ? "none" : this.name; }

function apply(f, value) { return f(value); }
console.log(apply(one, 1), apply(two, 1), apply(one, "s"), apply(two, 0.25), apply(one, undefined), apply(two, null), apply(one, 2n ** 70n === 0n));

function applyInLoop(f, values) { let out = []; for (let i = 0; i < values.length; i++) out.push(f(values[i])); return out.join(); }
console.log(applyInLoop(one, [1, 2, 3]), applyInLoop(two, ["a", 0.5, true]));

const holder = { run: one };
function throughField(o, value) { const f = o.run; return f(value); }
console.log(throughField(holder, 1));
holder.run = two;
console.log(throughField(holder, "field"));

const table = [three, four];
for (let i = 0; i < 4; i++) { const f = table[i & 1]; console.log(f(i), f(i, "second"), f()); }

function maker(f) { return (value) => f(value, value); }
console.log(maker(three)(1), maker(four)(2), maker(five)(3));

function choose(i) { return i % 3 === 0 ? three : i % 3 === 1 ? four : five; }
for (let i = 0; i < 6; i++) console.log(choose(i)(i), choose(i)(...[i, i + 1, i + 2]), choose(i).call(null, "called"), choose(i).apply(null, ["applied", 1]));

function receiver(i) { return i & 1 ? six : seven; }
const named = { name: "named" };
for (let i = 0; i < 4; i++) { const f = receiver(i); console.log(f(), f.call(named), Reflect.apply(f, named, [])); }

function deep(f, n) { return n ? deep(f, n - 1) : f(n); }
console.log(deep(one, 3), deep(two, 3));

function self(i) { return i & 1 ? down : up; }
function down(n) { return n <= 0 ? "down" : self(n)(n - 1); }
function up(n) { return n <= 0 ? "up" : self(n)(n - 2); }
console.log(down(7), up(8), self(1)(5), self(2)(6));
