// Object.assign runs the getter of its source, which counts in a field that the body has read just before.
const source = { raw: 3, reads: 0, get value() { this.reads++; return this.raw; } };
const target = { raw: 0, reads: 0, value: 0 };
function copy(into, from) { const before = from.reads; Object.assign(into, from); return from.reads - before; }
let sum = 0;
for (let i = 0; i < 300; i++) sum += copy(target, source);
console.log(sum, source.reads, target.reads, target.value);
