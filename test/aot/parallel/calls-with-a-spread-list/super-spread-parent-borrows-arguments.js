// A chain of constructors that each forward `arguments`. A parent that takes nothing but `arguments` reads them out of its child's array.
const seen = [];
class Base {
  constructor(parent, scope) { this.parent = parent; this.scope = scope; }
}
class Forwards extends Base {
  constructor() { super(...arguments); this.level = 1; }
}
class ForwardsTwice extends Forwards {
  constructor() { super(...arguments); this.level = 2; }
}
class ForwardsThrice extends ForwardsTwice {
  constructor() { super(...arguments); this.level = 3; }
}
class Counts extends Base {
  constructor() { super(...arguments); this.count = arguments.length; this.last = arguments[arguments.length - 1]; }
}
class OverCounts extends Counts {
  constructor() { super(...arguments); this.own = arguments.length; }
}
class Keeps extends Base {
  constructor() { super(...arguments); this.kept = arguments; }
}
class OverKeeps extends Keeps {
  constructor() { super(...arguments); arguments[0] = "changed by the child"; this.first = arguments[0]; }
}
class Writes extends Base {
  constructor() { arguments[0] = "written by the parent"; arguments.length = 1; super(...arguments); }
}
class OverWrites extends Writes {
  constructor() { super(...arguments); this.first = arguments[0]; this.count = arguments.length; }
}
class Captures extends Base {
  constructor() { super(...arguments); this.read = () => Array.prototype.join.call(arguments); }
}
class OverCaptures extends Captures {
  constructor() { super(...arguments); }
}
class WritesFirst extends Forwards {
  constructor() { arguments[0] = "replaced"; super(...arguments); }
}
class RestOverForwards extends Forwards {
  constructor(...rest) { super(...rest); rest.push("pushed afterward"); this.rest = rest; }
}
const show = node => node.constructor.name + " " + JSON.stringify(node, (key, value) => (value === undefined ? "undefined" : key === "kept" ? Array.prototype.slice.call(value) : value)) + (node.read ? " reads " + node.read() : "");
const constructors = [Forwards, ForwardsTwice, ForwardsThrice, Counts, OverCounts, Keeps, OverKeeps, Writes, OverWrites, Captures, OverCaptures, WritesFirst, RestOverForwards];
const lists = [[], ["p"], ["p", "s"], ["p", "s", "extra"], [1, 2], [1.5, 2.5], [undefined, null], ["a", "b", "c", "d", "e", "f", "g", "h", "i"]];
for (let round = 0; round < 3; round++)
  for (const Constructor of constructors)
    for (const list of lists) seen.push(show(new Constructor(...list)));
seen.push(show(new ForwardsThrice("p", "s")), show(new ForwardsThrice()), show(new OverCounts(1, 2, 3)), show(new OverKeeps("p", "s")));
seen.push(show(new RestOverForwards(1.5, 2.5)), show(new RestOverForwards(1, 2)), show(new RestOverForwards()), show(new OverCounts(1.5, 2.5)), show(new OverKeeps(1, 2.5)), show(new OverCaptures(1.5, 2)));

const long = new Array(70000).fill("x"); long[0] = "first";
for (const Constructor of [ForwardsThrice, OverCounts]) {
  try { seen.push("long " + show(new Constructor(...long)).slice(0, 90)); } catch (error) { seen.push("long " + Constructor.name + " " + error.constructor.name); }
}

// The parent in the middle is replaced: the speculation on it fails.
Object.setPrototypeOf(ForwardsTwice, Counts); seen.push(show(new ForwardsThrice("p", "s", "t")));
Object.setPrototypeOf(ForwardsTwice, function () { this.joined = Array.prototype.join.call(arguments); }); seen.push(show(new ForwardsThrice("p", "s")));
Object.setPrototypeOf(ForwardsTwice, Forwards); seen.push(show(new ForwardsThrice("p", "s")));
seen.push(show(Reflect.construct(ForwardsThrice, ["p", "s"], Counts)), String(Reflect.construct(ForwardsThrice, ["p"], Base) instanceof ForwardsThrice));
console.log(seen.join("\n"));
