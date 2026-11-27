// A derived constructor that forwards `arguments` to a parent with plain parameters. The parent's parameters are read from the argument array itself, in every arm.
const seen = [];
class Base {
  constructor(parent, scope) { this.parent = parent; this.scope = scope; }
}
class WithDefault {
  constructor(parent, scope = "default", last) { this.parent = parent; this.scope = scope; this.last = last; }
}
class NoParameters {
  constructor() { this.none = true; }
}
class Middle extends Base {
  constructor() { super(...arguments); this.variable = null; }
}
class Leaf extends Middle {
  constructor() { super(...arguments); this.leaf = true; }
}
class OverDefault extends WithDefault {
  constructor() { super(...arguments); this.variable = 1; }
}
class OverNone extends NoParameters {
  constructor() { super(...arguments); this.variable = 2; }
}
class ReadsAfterward extends Base {
  constructor() { super(...arguments); this.first = arguments[0]; this.length = arguments.length; }
}
class ParentWritesItsParameters extends (class { constructor(a, b) { a = "written"; b = "written too"; this.a = a; this.b = b; } }) {
  constructor() { super(...arguments); this.first = arguments[0]; this.second = arguments[1]; }
}
const show = node => node.constructor.name + " " + JSON.stringify(node, (key, value) => (value === undefined ? "undefined" : value));
const constructors = [Middle, Leaf, OverDefault, OverNone, ReadsAfterward, ParentWritesItsParameters];
const lists = [[], ["p"], ["p", "s"], ["p", undefined, "l"], ["p", "s", "l", "extra"], [1, 2], [1.5, 2.5], [{ a: 1 }, [2]], [null, null]];
for (let round = 0; round < 3; round++)
  for (const Constructor of constructors)
    for (const list of lists) seen.push(show(new Constructor(...list)));
seen.push(show(new Middle("p", "s")), show(new Leaf("p")), show(new OverDefault()), show(new OverNone(1, 2, 3)));

// More arguments than a call takes on the stack.
const long = new Array(70000).fill("x"); long[0] = "first"; long[1] = "second";
for (const Constructor of constructors) {
  try { seen.push("long " + show(new Constructor(...long)).slice(0, 90)); } catch (error) { seen.push("long " + Constructor.name + " " + error.constructor.name); }
}

// The parent is replaced: the speculation on it fails.
Object.setPrototypeOf(Middle, WithDefault); seen.push(show(new Middle("p")), show(new Leaf("p", undefined, "l")));
Object.setPrototypeOf(Middle, function () { this.joined = Array.prototype.join.call(arguments); }); seen.push(show(new Middle("p", "s", "t")), show(new Leaf()));
Object.setPrototypeOf(Middle, Base); seen.push(show(new Middle("p", "s")), show(new Leaf("p", "s")));
seen.push(show(Reflect.construct(Middle, ["p", "s"], OverNone)), String(Reflect.construct(Leaf, ["p"], Base) instanceof Leaf));

console.log(seen.join("\n"));
