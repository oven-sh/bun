"use strict";
const held = { count: 1 };
const accessors = { first: { get() { return this.base + 1; } }, box: { value: held, writable: true } };
const internals = { kept: undefined, other: 1 };
function Writer(base) { this.base = base; }
Object.defineProperties(Writer.prototype, accessors);
internals.kept = accessors;
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { const writer = new Writer(i); writer.box.count += 1; internals.kept.box.value.count += 10; s += writer.first + writer.box.count; } return s; }
console.log(drive(+(process.argv[2] ?? 50)), held.count, Object.keys(Writer.prototype).length, internals.kept.first.get.call({ base: 4 }));
