// A spread runs the getter of its source, which lays a name that the literal does not list; the body asks for the name before and behind.
const source = { raw: 3, get value() { this.read = this.raw; return 7; } };
function copy(from) { const before = typeof from.read; const made = { ...from }; return before + typeof from.read + made.value + typeof made.read; }
console.log(copy(source), copy(source), source.read);
