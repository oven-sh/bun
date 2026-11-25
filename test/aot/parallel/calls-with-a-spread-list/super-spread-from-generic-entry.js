// Constructors and functions that only forward `arguments`, reached through callees that are not known at build time. Their generic entries read the arguments from the frame.
// STATISTIC: RestArrayAllocationsSunk >= 2
const seen = [];
class Base {
  constructor(parent, scope) { this.parent = parent; this.scope = scope; this.target = new.target.name; }
}
class ThreeParameters {
  constructor(a, b = "default", c) { this.a = a; this.b = b; this.c = c; }
}
class Node extends Base {
  constructor() { super(...arguments); this.variable = null; }
}
class Leaf extends Node {
  constructor() { super(...arguments); this.leaf = true; }
}
class Wide extends ThreeParameters {
  constructor() { super(...arguments); this.wide = true; }
}
class CountsToo extends Base {
  constructor() { super(...arguments); this.count = arguments.length; }
}
const record = function () { this.recorded = Array.prototype.join.call(arguments, "+"); this.recordedCount = arguments.length; };
class AppliesAfterSuper extends Base {
  constructor() { super("own", "arguments"); record.apply(this, arguments); }
}
class SpreadsAfterSuper extends Base {
  constructor() { super(); this.sum = add(...arguments); }
}
class InBranch extends Base {
  constructor() { if (seen.length >= 0) super(...arguments); else super(); this.branch = true; }
}
class ThrowsInParent extends (class { constructor(a) { if (a === "throw") throw new RangeError("from the parent"); this.a = a; } }) {
  constructor() { super(...arguments); this.after = true; }
}
function add(a, b) { return String(a) + "&" + String(b); }
function Plain(a, b) { this.a = a; this.b = b; }
let callee = add, Constructor = Plain;
function forwardsCall() { return callee(...arguments); }
function forwardsKnownCall() { return add(...arguments); }
function forwardsConstruct() { return new Constructor(...arguments); }
function forwardsRest(...rest) { return add(...rest); }
const show = value => (typeof value === "object" && value ? value.constructor.name + " " : "") + JSON.stringify(value, (key, held) => (held === undefined ? "undefined" : held));
const classes = [Node, Leaf, Wide, CountsToo, AppliesAfterSuper, SpreadsAfterSuper, InBranch, ThrowsInParent];
const functions = [forwardsCall, forwardsKnownCall, forwardsConstruct, forwardsRest];
const lists = [[], ["p"], ["p", "s"], ["p", undefined, "c"], ["p", "s", "c", "d"], ["p", "s", "c", "d", "e", "f"], [1, 2], [1.5, 2.5], [null, { a: 1 }]];
for (let round = 0; round < 3; round++) {
  for (let index = 0; index < classes.length; index++) {
    const Class = classes[index];
    seen.push(show(new Class()), show(new Class("p")), show(new Class("p", "s")), show(new Class("p", undefined, "c")), show(new Class("p", "s", "c", "d", "e")));
    for (const list of lists) seen.push(show(new Class(...list)), show(Reflect.construct(Class, list)), show(Reflect.construct(Class, list, Base)));
  }
  for (let index = 0; index < functions.length; index++) {
    const forward = functions[index];
    seen.push(show(forward()), show(forward("p")), show(forward("p", "s")), show(forward("p", "s", "c")));
    for (const list of lists) seen.push(show(forward(...list)), show(forward.apply(null, list)), show(forward.call(null, ...list)));
  }
}
for (const Class of classes) {
  try { Class("p", "s"); seen.push("called"); } catch (error) { seen.push(Class.name + " without new: " + error.constructor.name); }
  try { seen.push(show(new Class("throw", "s"))); } catch (error) { seen.push(Class.name + ": " + error.message); }
}
const long = new Array(70000).fill("x"); long[0] = "first"; long[1] = "second";
for (const Class of classes) {
  try { seen.push("long " + show(new Class(...long)).slice(0, 80)); } catch (error) { seen.push("long " + Class.name + " " + error.constructor.name); }
}
for (const forward of functions) {
  try { seen.push("long " + show(forward(...long)).slice(0, 80)); } catch (error) { seen.push("long " + forward.name + " " + error.constructor.name); }
}
// The speculations fail: another parent, another callee.
Object.setPrototypeOf(Node, ThreeParameters);
for (const Class of [Node, Leaf]) seen.push(show(new Class("p")), show(new Class("p", "s", "c", "d")));
Object.setPrototypeOf(Node, function () { this.joined = Array.prototype.join.call(arguments); });
for (const Class of [Node, Leaf]) seen.push(show(new Class()), show(new Class("p", "s", "c")));
Object.setPrototypeOf(Node, Base);
for (const Class of [Node, Leaf]) seen.push(show(new Class("p", "s")));
callee = function () { return "other " + arguments.length; }; Constructor = ThreeParameters;
for (const forward of functions) seen.push(show(forward("p", "s", "c")));
console.log(seen.join("\n"));
