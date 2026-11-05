Array.prototype[Symbol.for("nodejs.util.inspect.custom")] = function () { return "custom " + this.length; };
const thing = [1];
console.log(thing);
