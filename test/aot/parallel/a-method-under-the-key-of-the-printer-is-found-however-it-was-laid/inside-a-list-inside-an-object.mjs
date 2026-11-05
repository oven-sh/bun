const thing = { list: [{ size: 1, [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } }] };
console.log(thing);
