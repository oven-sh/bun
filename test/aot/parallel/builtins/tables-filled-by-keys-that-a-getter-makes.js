// symbols.set(base.name, base): the key is read off an object whose getter runs code on the table
function add(table, items) { for (const item of items) { if (!table.get(item.name)) table.set(item.name, item); } return table.size; }
const table = new Map();
let reads = 0;
const plain = [{ name: "a" }, { name: "b" }, { name: "a" }];
console.log(add(table, plain), [...table.keys()].join());
const sly = { get name() { reads++; if (reads === 2) table.set = function (k, v) { return Map.prototype.set.call(this, "sly:" + k, v); }; return "c" + reads; } };
console.log(add(table, [sly, sly]), [...table.keys()].join(), reads);
delete table.set;
console.log(add(table, [{ name: "d" }]), [...table.keys()].join());
const below = new Map();
console.log(add(below, [{ get name() { Object.setPrototypeOf(below, { get() { return undefined; }, set() { reads += 100; }, __proto__: Map.prototype }); return "e"; } }]), reads);
