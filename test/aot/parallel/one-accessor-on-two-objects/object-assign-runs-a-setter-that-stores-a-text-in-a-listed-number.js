// Object.assign runs the setter of its target, which stores a text where the literal lists a number; the body reads the field before and behind the copy.
const target = { low: 0, seen: 0, set value(next) { this.seen = "s" + next; } };
function copy(into, from) { const before = typeof into.seen; Object.assign(into, from); return before + typeof into.seen; }
console.log(copy(target, { value: 5 }), copy(target, { value: 6 }), target.seen + 1);
