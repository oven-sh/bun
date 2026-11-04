// A literal that is put below the first one later finds the pair there and is `this`. One store and one read meet both.
const above = { raw: 1, get value() { this.read = 1; return this.raw; }, set value(next) { this.seen = next; this.raw = next; } };
const below = { low: 0 };
function put(held, next) { held.value = next; return typeof held.seen; }
function get(held) { return held.value + typeof held.read; }
console.log(put(above, 6), get(above), put(below, 4), get(below));
Object.setPrototypeOf(below, above);
delete below.value;
console.log(get(below), put(below, 5), get(below), above.raw, Object.keys(below).join());
