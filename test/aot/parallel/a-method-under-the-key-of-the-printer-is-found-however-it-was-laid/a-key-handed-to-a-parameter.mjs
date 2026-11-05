function lay(object, key, value) { object[key] = value; return object; }
lay({}, "plain", 1);
const thing = lay({ size: 1 }, Symbol.for("nodejs.util.inspect.custom"), function () { return "custom " + this.size; });
console.log(thing);
