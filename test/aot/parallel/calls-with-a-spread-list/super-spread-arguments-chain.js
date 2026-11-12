// Constructors that forward `arguments` to super, as TypeScript emits for class fields. Each level used to copy the arguments into a second array.
// STATISTIC: SpreadCallArrayCopiesElided >= 3
const seen = [];
class Base {
  constructor(parent, scope) { this.parent = parent; this.scope = scope; this.count = arguments.length; }
}
class Middle extends Base {
  constructor() { super(...arguments); this.variable = null; this.isReference = false; }
}
class Leaf extends Middle {
  constructor() { super(...arguments); this.variable = "leaf"; }
}
class ReadsAfterward extends Middle {
  constructor() { super(...arguments); this.first = arguments[0]; this.length = arguments.length; arguments[0] = "changed"; this.changed = arguments[0]; }
}
class WritesBefore extends Middle {
  constructor(parent) { arguments[0] = "replaced"; super(...arguments); this.named = parent; }
}
class KeepsArguments extends Middle {
  constructor() { super(...arguments); this.kept = arguments; }
}
class InArrow extends Middle {
  constructor() { const build = () => super(...arguments); build(); this.variable = "arrow"; }
}
const constructors = [Leaf, Middle, ReadsAfterward, WritesBefore, KeepsArguments, InArrow, Base];
const show = node => JSON.stringify(node, (key, value) => (value === undefined ? "undefined" : key === "kept" ? Array.prototype.slice.call(value) : value));
const lists = [[], ["p"], ["p", "s"], ["p", "s", "extra"], [1.5, 2.5], [undefined, null], ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]];
for (let round = 0; round < 3; round++)
  for (const Constructor of constructors)
    for (const list of lists) seen.push(Constructor.name + " " + show(new Constructor(...list)) + " < " + list.join());
seen.push(show(new Leaf("p", "s")), show(new Leaf()), show(Reflect.construct(Leaf, ["p", "s"], Base)), String(Reflect.construct(Leaf, ["p"], Base) instanceof Leaf));
Object.setPrototypeOf(Leaf, Base); seen.push(show(new Leaf("p", "s")));
Object.setPrototypeOf(Leaf, function () { this.old = Array.prototype.join.call(arguments); }); seen.push(show(new Leaf("p", "s")));
Object.setPrototypeOf(Leaf, Middle); seen.push(show(new Leaf("p", "s")));
class OwnIterator extends Middle {
  constructor() { arguments[Symbol.iterator] = function* () { yield "from"; yield "another iterator"; }; super(...arguments); }
}
class ShorterLength extends Middle {
  constructor() { arguments.length = 1; super(...arguments); }
}
seen.push(show(new OwnIterator("p", "s")), show(new ShorterLength("p", "s")));
console.log(seen.join("\n"));
