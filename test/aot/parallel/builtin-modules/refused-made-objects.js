// A host function that refuses an object says what it is: it reads `constructor` and, off that, `name`. The object here was made by a call of a built-in, not by a literal or `new`.
const fs = require("node:fs");
function told(f) { try { return String(f()); } catch (e) { return e.code + ": " + e.message; } }
const named = name => ({ get name() { return name; } });

console.log("one operand", told(() => { const o = Object.create(Blob.prototype); Object.defineProperty(o, "constructor", { get() { return { name: "OneOperand" }; } }); return o.text(); }));
console.log("a value defined later", told(() => { const o = Object.create(Blob.prototype, { other: { value: 1 } }); Object.defineProperty(o, "constructor", { value: named("ValueLater") }); return o.text(); }));
console.log("stored", told(() => { const o = Object.create(Blob.prototype, { other: { value: 1 } }); o.constructor = named("Stored"); return o.text(); }));
console.log("an empty map", told(() => { const o = Object.create(Blob.prototype, {}); Object.defineProperty(o, "constructor", { get() { return { name: "EmptyMap" }; } }); return o.text(); }));
console.log("by call", told(() => { const o = Object.create(Blob.prototype, { other: { value: 1 } }); Object.defineProperty(o, "constructor", { get() { return { name: "ByCall" }; } }); return Blob.prototype.text.call(o); }));
console.log("in the map", told(() => Object.create(Blob.prototype, { constructor: { get() { return { name: "InTheMap" }; } } }).text()));
console.log("from entries", told(() => Blob.prototype.text.call(Object.fromEntries([["constructor", named("FromEntries")]]))));
console.log("assigned", told(() => Blob.prototype.text.call(Object.assign(Object.create(null, {}), { constructor: named("Assigned") }))));
console.log("an operand", told(() => fs.readFileSync(Object.create({}, { constructor: { value: named("Operand") } }))));
console.log("an operand, later", told(() => { const o = Object.create({}, {}); o.constructor = named("OperandLater"); return fs.readFileSync(o); }));
console.log("an operand from entries", told(() => fs.readFileSync(Object.fromEntries([["constructor", named("OperandFromEntries")]]))));
