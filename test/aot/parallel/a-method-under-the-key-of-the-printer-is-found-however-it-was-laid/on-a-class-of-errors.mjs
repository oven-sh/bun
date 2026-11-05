class Failure extends Error { size = 1; [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } }
const thing = new Failure("no");
console.log(thing);
