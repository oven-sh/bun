const key = Symbol.for(["nodejs", "util", "inspect", "custom"].join("."));
const thing = { size: 1 };
thing[key] = function () { return "custom " + this.size; };
console.log(thing);
