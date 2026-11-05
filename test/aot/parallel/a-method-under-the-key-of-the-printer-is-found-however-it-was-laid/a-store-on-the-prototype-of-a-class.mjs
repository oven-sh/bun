class Thing { size = 1; }
Thing.prototype[Symbol.for("nodejs.util.inspect.custom")] = function () { return "custom " + this.size; };
const thing = new Thing();
console.log(thing);
