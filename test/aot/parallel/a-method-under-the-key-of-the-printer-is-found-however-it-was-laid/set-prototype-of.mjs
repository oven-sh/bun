const base = { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } };
const thing = Object.setPrototypeOf({ size: 1 }, base);
console.log(thing);
