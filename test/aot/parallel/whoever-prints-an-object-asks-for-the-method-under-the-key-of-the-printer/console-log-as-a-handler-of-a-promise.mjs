class Thing { size = 1; [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } }
const thing = new Thing();
await Promise.resolve(thing).then(console.log);
