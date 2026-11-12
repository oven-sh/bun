const thing = Object.assign({ size: 1 }, { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } });
console.log(thing);
