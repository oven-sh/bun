// Accessors are defined on a prototype under computed names. Stores and reads under those names go through them in a hot loop; then every neighbor of the case is asked:
// a name that meets no accessor, a getter without a setter, a class below such a prototype, accessors defined after objects are made, the order of keys, what is own, a deletion, a frozen object.
"use strict";
function defineColumns(Model, columns) {
  for (const column of columns) Object.defineProperty(Model.prototype, column, { enumerable: true, configurable: true, get() { return this.values[column]; }, set(v) { if (this.values[column] !== v) { this.values[column] = v; this.changed.add(column); } } });
  return Model;
}
const Named = defineColumns(class { constructor(row) { this.values = { ...row }; this.changed = new Set(); } }, ["price", "stock"]);
const name = "Product";
const OutOfRecord = defineColumns({ [name]: class { constructor(row) { this.values = { ...row }; this.changed = new Set(); } } }[name], ["price", "stock"]);
class Below extends Named { constructor(row) { super(row); this.own = 1; } }
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
function turn(Model, t) { let out = 0; for (let i = 0; i < 40; i++) { const p = new Model({ price: i, stock: t }); p.price = p.price + (i % 3); if (p.stock < 4) p.stock = p.stock + 1; p.extra = i; out += p.price + p.stock + p.changed.size + p.extra; } return out; }
for (const Model of [Named, OutOfRecord, Below]) { let sum = 0; for (let t = 0; t < 300; t++) sum = (sum + turn(Model, t % 7)) % 1000003; console.log(sum); }
for (const Model of [Named, OutOfRecord, Below]) {
  const p = new Model({ price: 1, stock: 2 });
  p.price = 5; p.extra = 6; p.stock = 2;
  console.log(Object.keys(p).join(), Object.hasOwn(p, "price"), Object.hasOwn(p, "extra"), "price" in p, [...p.changed].join(), JSON.stringify(p.values));
  const seen = []; for (const key in p) seen.push(key); console.log(seen.join());
  console.log(attempt(() => delete p.extra), p.extra, attempt(() => delete p.price), p.price);
  Object.defineProperty(p, "price", { value: 9, writable: true, enumerable: true, configurable: true }); p.price = 10;
  console.log(p.price, p.values.price, Object.keys(p).join());
}
Object.defineProperty(Named.prototype, ["read", "Only"].join(""), { get() { return 7; }, configurable: true });
const q = new Named({ price: 1 });
console.log(q.readOnly, attempt(() => { q.readOnly = 8; return "stored"; }), q.readOnly, Object.hasOwn(q, "readOnly"));
const early = new Named({ late: 3 }); early.late = 4;
console.log(early.late, Object.hasOwn(early, "late"), early.values.late);
defineColumns(Named, ["late"]);
const after = new Named({ late: 3 }); after.late = 5;
console.log(early.late, after.late, Object.hasOwn(after, "late"), after.values.late, [...after.changed].join());
const frozen = Object.freeze(new Below({ price: 1 }));
console.log(attempt(() => { frozen.price = 2; return frozen.price; }), attempt(() => { frozen.extra = 2; return "stored"; }), attempt(() => { frozen.own = 2; return "stored"; }));
delete Named.prototype.price;
const bare = new Named({ price: 1 }); console.log(bare.price); bare.price = 3; console.log(bare.price, Object.hasOwn(bare, "price"), bare.values.price);
