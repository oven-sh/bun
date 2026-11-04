// As its neighbor, with the two literals made, defined on and stored to in the other order.
function both(next) { if (next === undefined) this.read = 1; else this.seen = next; return 7; }
const narrow = { low: 0 }, wide = { raw: 0, more: 1 };
Object.defineProperty(narrow, "value", { get: both, set: both });
Object.defineProperty(wide, "value", { get: both, set: both });
function put(held, next) { held.value = next; return typeof held.seen; }
function get(held) { return held.value + typeof held.read; }
console.log(put(narrow, "x"), put(wide, 5), get(narrow), get(wide), typeof wide.seen, typeof narrow.seen);
