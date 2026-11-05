const thing = Object.create(null, { size: { value: 1 }, [Symbol.for("nodejs.util.inspect.custom")]: { value() { return "custom " + this.size; } } });
console.log(thing);
