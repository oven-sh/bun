const keys = ["plain", Symbol.for("nodejs.util.inspect.custom")];
const thing = { size: 1 };
for (const key of keys) thing[key] = function () { return "custom " + this.size; };
console.log(thing);
