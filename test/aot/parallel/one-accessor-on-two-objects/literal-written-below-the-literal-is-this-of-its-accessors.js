// A literal that is written with the first one above it finds the pair there and is `this`. One store and one read meet both.
const above = { raw: 1, get value() { this.read = 1; return this.raw; }, set value(next) { this.seen = next; this.raw = next; } };
const below = { __proto__: above, low: 0 };
function put(held, next) { held.value = next; return typeof held.seen; }
function get(held) { return held.value + typeof held.read; }
console.log(get(below), put(below, 5), get(below), typeof above.seen, typeof above.read, above.raw, Object.keys(below).join());
console.log(put(above, 6), get(above), below.raw, above.raw);
