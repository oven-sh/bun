const key = Symbol.for("shared");
console.log(Symbol.keyFor(key).length, Symbol.keyFor(Symbol("own")) === undefined, Symbol.for("shared") === key, key.description.length);
