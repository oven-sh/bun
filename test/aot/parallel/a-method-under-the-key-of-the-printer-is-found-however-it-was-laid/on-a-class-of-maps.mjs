class Table extends Map { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } }
const thing = new Table([[1, 1]]);
console.log(thing);
