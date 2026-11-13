// Classes made by functions over their parent: a constructor that hands its rest list to super leaves for the construction where the parent is another.
// STATISTIC: RestArrayAllocationsSunk >= 25
const said = [], log = [];
const show = v => (typeof v === "object" && v ? JSON.stringify(v) : String(v));
const attempt = f => { try { said.push(show(f())); } catch (error) { said.push(error.constructor.name); } };
const Counted = Parent => class extends Parent { static count = 0; constructor(...all) { super(...all); this.order = ++new.target.count; } };
const Named = Parent => class extends Parent { constructor(...all) { super(...all); this.name = "n" + this.id; } };
const Logged = Parent => class extends Parent { constructor(...all) { log.push(all.length); super(...all); this.logged = all.length; } };
const Changed = Parent => class extends Parent { constructor(...all) { all[0] = "changed"; super(...all); this.changed = all[0]; } };
const Kept = Parent => class extends Parent { constructor(...all) { super(...all); this.all = all; } };
class Item { constructor(id) { this.id = id; } }
class Other { constructor(a) { this.other = a; } }
class Plain extends Item {}
class One extends Counted(Item) {}
class Both extends Counted(Named(Item)) {}
class Twice extends Counted(Counted(Plain)) {}
class Loud extends Logged(Item) {}
class Odd extends Changed(Named(Item)) {}
class Keeper extends Kept(Counted(Item)) {}
const given = JSON.parse("[4,5,6]");
let total = 0;
for (let i = 0; i < 300; i++) {
  total += new One(i & 63).order & 7; total += new Both(i & 31).order & 3; total += new Twice(i).order | 0; total += new Plain(i).id & 1;
  if (i % 50 === 0) { attempt(() => new One(i, 2)); attempt(() => new Both(...given)); attempt(() => new Loud(i)); attempt(() => new Odd(i, 3)); attempt(() => new Keeper(i, "k")); attempt(() => Reflect.construct(Both, [i], Other)); attempt(() => Object.keys(new Both(1)).join()); }
  if (i === 220) Object.setPrototypeOf(One, Other);
  if (i === 240) Object.setPrototypeOf(Object.getPrototypeOf(Both), Other);
  if (i === 260) Object.setPrototypeOf(Twice, function F(a) { this.f = a; });
  if (i === 280) Object.setPrototypeOf(Loud, null);
}
attempt(() => new One(1)); attempt(() => new Both(2)); attempt(() => new Twice(3)); attempt(() => new Loud(4)); attempt(() => new Plain(5));
attempt(() => [One.count, Both.count, Twice.count, Keeper.count].join());
console.log(total, log.join()); console.log(said.join("\n"));
