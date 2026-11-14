// Classes that write no constructor, and functions that only forward a rest parameter, reached through callees that are not known at build time.
// STATISTIC: RestArrayAllocationsSunk >= 4
const seen = [];
class Base {
  constructor(parent, scope) { this.parent = parent; this.scope = scope; this.target = new.target.name; }
}
class Counts {
  constructor() { this.count = arguments.length; this.joined = Array.prototype.join.call(arguments); }
}
class WithDefault {
  constructor(a, b = "default", ...others) { this.a = a; this.b = b; this.others = others; }
}
class Plain extends Base { kind() { return "plain"; } }
class Deeper extends Plain { kind() { return "deeper"; } }
class Deepest extends Deeper { kind() { return "deepest"; } }
class OverExplicit extends (class Explicit extends Base { constructor() { super(...arguments); this.explicit = true; } }) { }
class ExplicitOverPlain extends Plain { constructor() { super(...arguments); this.over = true; } }
class RestOverPlain extends Plain { constructor(...rest) { super(...rest); this.rest = rest; rest.push("pushed"); } }
class OverCounts extends Counts { }
class OverOverCounts extends OverCounts { }
class OverDefault extends WithDefault { }
class WithFields extends Base { field = "set"; other = this.parent; }
class OverFunction extends (function Old(a, b) { this.a = a; this.b = b; this.count = arguments.length; }) { }
class List extends Array { }
class Failure extends Error { }
class Table extends Map { }
class OverNull extends null { }
function add(a, b) { return String(a) + "&" + String(b); }
let callee = add;
function forwardsRest(...rest) { return callee(...rest); }
function forwardsRestToKnown(...rest) { return add(...rest); }
function forwardsAfterFirst(first, ...rest) { return first + ":" + add(...rest); }
function writesThenForwards(...rest) { rest[0] = "written"; return add(...rest); }
function keepsRest(...rest) { seen.length += 0; const result = add(...rest); return result + rest.length; }
const show = value => (typeof value === "object" && value ? value.constructor.name + " " + (value.kind ? value.kind() + " " : "") : "") + JSON.stringify(value instanceof Map ? [...value] : value instanceof Error ? value.message : value, (key, held) => (held === undefined ? "undefined" : held));
const classes = [Plain, Deeper, Deepest, OverExplicit, ExplicitOverPlain, RestOverPlain, OverCounts, OverOverCounts, OverDefault, WithFields, OverFunction];
const functions = [forwardsRest, forwardsRestToKnown, forwardsAfterFirst, writesThenForwards, keepsRest];
const lists = [[], ["p"], ["p", "s"], ["p", undefined, "c"], ["p", "s", "c", "d", "e", "f"], [1, 2], [1.5, 2.5], [null, { a: 1 }]];
for (let round = 0; round < 3; round++) {
  for (let index = 0; index < classes.length; index++) {
    const Class = classes[index];
    seen.push(show(new Class()), show(new Class("p")), show(new Class("p", "s")), show(new Class("p", "s", "c", "d")));
    for (const list of lists) seen.push(show(new Class(...list)), show(Reflect.construct(Class, list)), show(Reflect.construct(Class, list, Base)));
  }
  for (let index = 0; index < functions.length; index++) {
    const forward = functions[index];
    seen.push(show(forward()), show(forward("p")), show(forward("p", "s")), show(forward("p", "s", "c")));
    for (const list of lists) seen.push(show(forward(...list)), show(forward.apply(null, list)));
  }
  for (const Class of [List, Failure, Table]) {
    seen.push(show(new Class()), show(new Class(Class === Table ? [[1, 2]] : 3)), show(Class === Table ? new Class([[1, 2], [3, 4]]) : new Class(1, 2, 3)));
  }
}
for (const Class of [...classes, OverNull]) {
  try { Class("p", "s"); seen.push("called"); } catch (error) { seen.push(Class.name + " without new: " + error.constructor.name); }
}
try { new OverNull(); seen.push("constructed"); } catch (error) { seen.push("OverNull: " + error.constructor.name); }
const long = new Array(70000).fill("x"); long[0] = "first"; long[1] = "second";
for (const Class of classes) {
  try { seen.push("long " + show(new Class(...long)).slice(0, 80)); } catch (error) { seen.push("long " + Class.name + " " + error.constructor.name); }
}
for (const forward of functions) {
  try { seen.push("long " + show(forward(...long)).slice(0, 80)); } catch (error) { seen.push("long " + forward.name + " " + error.constructor.name); }
}
// The speculations fail: another parent, another callee.
Object.setPrototypeOf(Plain, WithDefault);
for (const Class of [Plain, Deeper, Deepest, ExplicitOverPlain]) seen.push(show(new Class("p")), show(new Class("p", "s", "c", "d")));
Object.setPrototypeOf(Plain, Counts);
for (const Class of [Plain, Deeper, Deepest, RestOverPlain]) seen.push(show(new Class()), show(new Class("p", "s", "c")));
Object.setPrototypeOf(Plain, Base);
for (const Class of [Plain, Deeper, Deepest]) seen.push(show(new Class("p", "s")));
callee = function () { return "other " + arguments.length; };
for (const forward of functions) seen.push(show(forward("p", "s", "c")));
console.log(seen.join("\n"));
