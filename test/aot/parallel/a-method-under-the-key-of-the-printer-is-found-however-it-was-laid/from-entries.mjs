const thing = Object.fromEntries([["size", 1], [Symbol.for("nodejs.util.inspect.custom"), function () { return "custom " + this.size; }]]);
console.log(thing);
