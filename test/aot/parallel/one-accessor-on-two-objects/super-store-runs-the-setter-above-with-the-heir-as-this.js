// `super.value = next` in a method of the literal below finds the setter above and runs it with the literal below as `this`.
const above = { raw: 1, get value() { this.read = 1; return this.raw; }, set value(next) { this.seen = next; this.raw = next; } };
const below = { __proto__: above, low: 0, put(next) { super.value = next; return typeof this.seen; }, get() { return super.value + typeof this.read; } };
console.log(below.get(), below.put(5), below.get(), typeof above.seen, typeof above.read, above.raw, below.raw);
