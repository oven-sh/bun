const base = { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } };
const thing = { __proto__: base, size: 1 };
console.log(thing);
