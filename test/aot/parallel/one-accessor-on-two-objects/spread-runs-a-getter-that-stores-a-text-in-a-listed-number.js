// A spread runs the getter, which stores a text where the literal lists a number; the body reads the field before and behind the copy.
const source = { raw: 3, read: 0, get value() { this.read = "r" + this.read; return 7; } };
function copy(from) { const before = typeof from.read; const made = { ...from }; return before + typeof from.read + made.value + typeof made.read; }
console.log(copy(source), copy(source), source.read + 1);
