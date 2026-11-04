// The pair is read off one literal as a descriptor and laid on another, so the same two functions run with either as `this`.
const first = { raw: 1, get value() { this.read = 1; return this.raw; }, set value(next) { this.seen = next; this.raw = next; } };
const second = { raw: "two", more: 0 };
Object.defineProperty(second, "value", Object.getOwnPropertyDescriptor(first, "value"));
function put(held, next) { held.value = next; return typeof held.seen; }
function get(held) { return held.value + typeof held.read; }
console.log(get(first), get(second), put(first, 5), put(second, "x"), get(first), get(second));
