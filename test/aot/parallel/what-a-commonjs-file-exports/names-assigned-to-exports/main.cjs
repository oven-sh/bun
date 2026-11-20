// `Object.assign(exports, require("./a"), { own })`: the names of what is copied are exports of the file.
// STATISTIC: ClosedClassObjects >= 5
"use strict";
const into = require("./modules/index-into.cjs"), { Figure, scale, name } = require("./modules/index-module.cjs"), above = require("./modules/index-above.cjs");
class Cube extends into.Figure { constructor(size) { super("cube", size); this.depth = size; } volume() { return this.area() * this.depth; } }
let sum = 0;
for (let i = 0; i < 400; i++) { sum += new Cube(i % 7).volume() + new Figure("f", i & 3).area() + into.scale(i, 3) + scale(i, 4) + above.scale(i, 5); sum |= 0; }
console.log(sum, into.Figure === Figure, above.Figure === Figure, into.first, into.last, into.name, name, above.name, above.first);
console.log(into.steps, into.step(), into.steps, require("./modules/figures.cjs").steps, above.steps, into.early);

// Looked at as a whole: an ordinary object.
const whole = require("./modules/index-whole.cjs");
for (const key of Object.keys(whole)) console.log(key, JSON.stringify(Object.getOwnPropertyDescriptor(whole, key), (k, v) => typeof v === "function" ? "function " + v.name : v));
// A getter without a setter refuses the copy; a frozen object too.
for (const load of [() => require("./modules/index-refused.cjs"), () => require("./modules/index-frozen.cjs"), () => require("./modules/index-later.cjs")]) { try { console.log(Object.keys(load()).join()); } catch (e) { console.log(e.name); } }
const later = require("./modules/index-later.cjs"); console.log(later.two, later.over, later.three());
