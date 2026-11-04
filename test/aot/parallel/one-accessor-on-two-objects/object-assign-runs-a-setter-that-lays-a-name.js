// Object.assign runs the setter of its target, which lays a name that the literal does not list; the body asks for the name before and behind.
const target = { low: 0, set value(next) { this.seen = next; } };
function copy(into, from) { const before = typeof into.seen; Object.assign(into, from); return before + typeof into.seen; }
console.log(copy(target, { value: 5 }), copy(target, { value: "x" }), target.seen);
