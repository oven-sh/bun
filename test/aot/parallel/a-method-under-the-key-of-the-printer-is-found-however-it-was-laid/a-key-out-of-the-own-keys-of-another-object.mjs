const source = { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } };
const thing = { size: 1 };
for (const key of Reflect.ownKeys(source)) thing[key] = source[key];
console.log(thing);
