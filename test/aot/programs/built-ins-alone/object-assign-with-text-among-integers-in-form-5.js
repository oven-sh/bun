const result = Object.assign(Symbol.for("name"), "text", 1.5);
console.log(result instanceof Symbol, typeof result.valueOf(), result.valueOf().description);
