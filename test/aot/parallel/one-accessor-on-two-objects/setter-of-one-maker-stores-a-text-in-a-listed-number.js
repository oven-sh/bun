// Two objects out of one maker. The setter stores a text where the literal lists a number; nothing is carried out; one store meets both.
function make(raw) { return { raw, seen: 0, set value(next) { this.seen = "s" + next; } }; }
function touch(held, next) { const before = typeof held.seen; held.value = next; return before + typeof held.seen; }
const first = make(1), second = make(2);
console.log(touch(first, 5), touch(second, 6), touch(first, 7), first.seen + 1, second.seen + 1);
