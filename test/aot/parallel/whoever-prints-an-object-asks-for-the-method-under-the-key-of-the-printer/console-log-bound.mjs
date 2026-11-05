class Thing { size = 1; [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } }
const thing = new Thing();
const say = console.log.bind(console, "it is");
say(thing);
