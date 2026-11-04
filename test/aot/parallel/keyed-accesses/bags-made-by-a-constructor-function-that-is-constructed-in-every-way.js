// A constructor function whose objects hold nothing is constructed by `new`, by Reflect.construct with another new.target, as the parent of a class, through bind, and called without `new`.
// Under: --aot-testing=CheckProofsAtRunTime: the layout of what a constructor function makes
function Bag() { made.push(new.target === undefined ? "call" : new.target.name); }
const made = [];
function fill(bag, keys) { for (const key of keys) bag[key] = key.length; return bag; }
function Other() {}
Other.prototype.who = function () { return "other"; };
Bag.prototype.who = function () { return "bag"; };
class Child extends Bag { constructor() { super(); this.own = 1; } }
const keys = JSON.parse('["x","yy","zzz"]');
const lines = [];
const plain = fill(new Bag(), keys);
const reflected = fill(Reflect.construct(Bag, [], Other), keys);
const child = fill(new Child(), keys);
const bound = fill(new (Bag.bind(null))(), keys);
lines.push(String(Bag()), made.join());
for (const bag of [plain, reflected, child, bound]) lines.push([bag.who(), bag instanceof Bag, bag instanceof Other, Object.keys(bag).join("|"), JSON.stringify(bag)].join(" "));
console.log(lines.join("\n"));
