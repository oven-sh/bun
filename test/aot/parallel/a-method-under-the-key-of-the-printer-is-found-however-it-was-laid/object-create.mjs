const base = { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } };
const thing = Object.create(base);
thing.size = 1;
console.log(thing);
