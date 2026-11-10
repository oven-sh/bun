// STATISTIC: BasesOfSuperReadOffRecordsOfClasses >= 3
const rows = JSON.parse('[{"price":3},{"price":5},{"price":8}]');
class Item { constructor(row) { this.price = row.price; } cost(k) { return this.price + k; } label() { return "item"; } static make(row) { return new this(row); } static kind() { return "I"; } }
class Taxed extends Item { cost(k) { return super.cost(k) * 2; } label() { return "taxed " + super.label(); } get half() { return super.cost(0) / 2; } static kind() { return "T" + super.kind(); } }
class Tipped extends Taxed { cost(k) { return super.cost(k) + 1; } label() { return "tipped " + super.label(); } }
class Other { cost(k) { return 1000 + k + (this.price ?? -1); } label() { return "other"; } }
const say = deed => { try { return String(deed()); } catch (e) { return e.name; } };
const tell = word => console.log(word, rows.map(row => { const it = Tipped.make(row); return [say(() => it.cost(1)), say(() => it.label()), say(() => it.half)].join(); }).join(" "), say(() => Tipped.kind()));
tell("as written");
Object.setPrototypeOf(Taxed.prototype, Other.prototype);
tell("another class laid above the home");
Other.prototype.cost = function (k) { return -k; };
tell("its method replaced");
Object.setPrototypeOf(Taxed.prototype, { label() { return "a literal"; } });
tell("a literal laid above: no cost there");
Object.setPrototypeOf(Taxed.prototype, null);
tell("nothing above");
Object.setPrototypeOf(Taxed.prototype, new Proxy(Item.prototype, { get(target, key, receiver) { return key === "label" ? () => "through a proxy" : Reflect.get(target, key, receiver); } }));
tell("a proxy above");
Object.setPrototypeOf(Taxed.prototype, Item.prototype);
tell("back as written");
const borrowed = { price: 40, cost: Tipped.prototype.cost, label: Taxed.prototype.label };
console.log(say(() => borrowed.cost(2)), say(() => borrowed.label()), say(() => Taxed.prototype.cost.call({ price: 7 }, 1)), say(() => Reflect.apply(Tipped.prototype.label, null, [])));
