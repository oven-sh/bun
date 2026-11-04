// The setter is taken off one literal and called with another as `this`.
const first = { raw: 1, set value(next) { this.seen = next; this.raw = next; } };
const second = { raw: "two", more: 0 };
const half = Object.getOwnPropertyDescriptor(first, "value").set;
first.value = 5;
half.call(second, "x");
console.log(typeof first.seen, typeof second.seen, first.raw, second.raw);
