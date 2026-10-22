const result = Object.getPrototypeOf(Symbol.for("name"));
console.log(typeof result, Object.keys(result).join());
