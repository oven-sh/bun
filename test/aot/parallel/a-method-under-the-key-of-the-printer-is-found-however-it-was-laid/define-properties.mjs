const thing = { size: 1 };
Object.defineProperties(thing, { [Symbol.for("nodejs.util.inspect.custom")]: { value() { return "custom " + this.size; } } });
console.log(thing);
