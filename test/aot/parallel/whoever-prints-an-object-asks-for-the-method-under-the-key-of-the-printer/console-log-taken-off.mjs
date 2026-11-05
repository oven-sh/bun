class Thing { size = 1; [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } }
const thing = new Thing();
const { log } = console;
log(thing);
