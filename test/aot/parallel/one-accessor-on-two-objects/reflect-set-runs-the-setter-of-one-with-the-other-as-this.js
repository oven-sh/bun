// Reflect.set and Reflect.get find the pair on one literal and run it with another as `this`.
const first = { raw: 1, get value() { this.read = 1; return this.raw; }, set value(next) { this.seen = next; this.raw = next; } };
const second = { raw: "two", more: 0 };
first.value = 5;
Reflect.set(first, "value", "x", second);
const got = Reflect.get(first, "value", second);
console.log(typeof first.seen, typeof second.seen, typeof first.read, typeof second.read, first.raw, second.raw, got);
