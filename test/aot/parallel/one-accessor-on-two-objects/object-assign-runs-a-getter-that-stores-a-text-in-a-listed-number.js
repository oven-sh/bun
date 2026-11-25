// Object.assign runs the getter of its source, which stores a text where the literal lists a number; the body reads the field before and behind the copy.
const source = { raw: 3, read: 0, get value() { this.read = "r" + this.read; return 7; } };
function copy(into, from) { const before = typeof from.read; Object.assign(into, from); return before + typeof from.read + into.value + typeof into.read; }
console.log(copy({ raw: 0, read: 0, value: 0 }, source), copy({ raw: 0, read: 0, value: 0 }, source), source.read + 1);
