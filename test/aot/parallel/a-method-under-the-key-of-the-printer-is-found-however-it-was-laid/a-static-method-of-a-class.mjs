class Thing { static size = 1; static [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } }
const thing = Thing;
console.log(thing);
