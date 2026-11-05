const source = { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } };
const thing = { size: 1, ...source };
console.log(thing);
