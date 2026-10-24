// `o.id = 7` is not lost when a loop below stores to o by computed keys.
const o = {};
if (globalThis.x) x();
o.id = 7;
for (const k in null) o[k] = 1;
console.log(o.id);
