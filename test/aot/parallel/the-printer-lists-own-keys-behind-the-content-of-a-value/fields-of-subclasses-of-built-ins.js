// console.log and Bun.inspect list the own keys of a Map, a Set, a typed array, a Promise, a Date, a RegExp and a wrapper object behind their content. Before the walk the printer asks the Structure whether there is a key at all, so a compiled class has to lay its fields where that answer sees them.
class Registry extends Map { name = "registry"; constructor(entries) { super(entries); this.made = 1; } }
class Bag extends Set { label = "bag"; }
class Bytes extends Uint8Array { tag = "t"; }
class Task extends Promise { id = 7; }
class Stamp extends Date { zone = "utc"; }
class Pattern extends RegExp { hint = "h"; }
class Count extends Number { unit = "ms"; }
class Hidden extends Map { #secret = 1; }
const values = [new Registry([[1, 2]]), new Registry(), new Bag([1]), new Bytes(2), new Task(() => {}), new Stamp(0), new Pattern("x"), new Count(3), new Hidden()];
for (let turn = 0; turn < 3; turn++) for (const value of values) console.log(Bun.inspect(value, { compact: true }));
console.log(values[0], values[5]);
const later = new Map();
console.log(Bun.inspect(later));
later.extra = 1;
console.log(Bun.inspect(later));
delete later.extra;
console.log(Bun.inspect(later));
console.log(Bun.inspect(Object.defineProperty(new Stamp(0), "unseen", { value: 1 })));
console.log(Bun.inspect([new Map([[1, 2]]), new Set([1]), new Uint8Array(1), new Date(0), /x/, new Number(1)], { compact: true }));
