const thing = { size: 1 };
Reflect.set(thing, Symbol.for("nodejs.util.inspect.custom"), function () { return "custom " + this.size; });
console.log(thing);
