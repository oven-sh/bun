const result = Object.assign(Symbol.for("name"), 2.5, "-");
console.log(result instanceof Symbol, typeof result.valueOf(), result.valueOf().description);
