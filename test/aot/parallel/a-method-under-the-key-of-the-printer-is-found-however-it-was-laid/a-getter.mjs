const thing = { size: 1, get [Symbol.for("nodejs.util.inspect.custom")]() { return () => "custom " + this.size; } };
console.log(thing);
