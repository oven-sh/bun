// Object.assign runs the getter of its source, which lays a name that the literal does not list; the body asks for the name before and behind.
const source = { raw: 3, get value() { this.read = this.raw; return 7; } };
function copy(into, from) { const before = typeof from.read; Object.assign(into, from); return before + typeof from.read; }
console.log(copy({ raw: 0, value: 0 }, source), copy({ raw: 0, value: 0 }, source), source.read);
