// One function lies as getter and as setter on two literals of different shapes; one store and one read meet both.
function both(next) { if (next === undefined) this.read = 1; else this.seen = next; return 7; }
const wide = { raw: 0, more: 1 }, narrow = { low: 0 };
Object.defineProperty(wide, "value", { get: both, set: both });
Object.defineProperty(narrow, "value", { get: both, set: both });
function put(held, next) { held.value = next; return typeof held.seen; }
function get(held) { return held.value + typeof held.read; }
console.log(put(wide, 5), put(narrow, "x"), get(wide), get(narrow), typeof wide.seen, typeof narrow.seen);
