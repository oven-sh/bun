class Thing { size = 1; [Symbol.for("nodejs.util.inspect.custom")] = () => "custom " + this.size; }
const thing = new Thing();
console.log(thing);
