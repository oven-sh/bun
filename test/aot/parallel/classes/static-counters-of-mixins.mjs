// Static fields of mixins are counted up through heirs, while a loop reads them off the heirs: the first store ends the guards of the name, and the others are plain stores.
const Counted = Parent => class extends Parent { static count = 0; constructor(...all) { super(...all); this.order = ++new.target.count; } };
class Item { constructor(id) { this.id = id; } }
class Both extends Counted(Item) {}
class Other extends Counted(Both) {}
function sum(n) { let t = 0; for (let k = 0; k < n; k++) t += Both.count + Other.count & 7; return t; }
const Seen = Parent => class extends Parent { static seen = 0; static last = null; constructor(...all) { super(...all); new.target.last = this; new.target.seen += this.id; } };
class Third extends Seen(Seen(Item)) { static made = 1; static { this.made += 4; } }
function total(n) { let t = 0; for (let k = 0; k < n; k++) t += Third.seen + Third.made & 7; return t; }
let t = sum(3) + total(3);
for (let k = 0; k < 2000; k++) { t += new Both(k & 63).order & 7; t += new Other(k & 63).order & 3; t += new Third(k & 63).id & 1; if (!(k & 511)) t += sum(10) + total(2); }
console.log(t, sum(10), total(10), Both.count, Other.count, Third.seen, Third.made, Third.last.id);
// Other kinds of values, other attributes and no property at all are still heard of.
Both.count = { valueOf() { return 100; } }; console.log(sum(4), +Other.count, +Both.count);
Object.defineProperty(Other, "count", { get() { return 7; }, set(v) { t = v; }, configurable: true }); console.log(new Other(1).order, t, sum(4), Other.count);
delete Both.count; console.log(new Both(1).order, Both.count, sum(4));
delete Other.count; delete Third.seen; delete Third.last; console.log(Other.count, Third.seen, Third.last, sum(4), total(4));
class Late extends Both {} console.log(Late.count, (Late.count = 4, sum(4)), Object.hasOwn(Late, "count"));
Object.freeze(Both); for (const make of [() => new Both(1), () => { class Later extends Both {} Later.count = 2; }]) try { make(); } catch (e) { console.log(e.constructor.name); } console.log(Both.count, sum(4));
