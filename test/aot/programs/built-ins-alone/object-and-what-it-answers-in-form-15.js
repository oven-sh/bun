const result = new Object(Symbol.for("name"));
console.log(result instanceof Symbol, typeof result.valueOf(), result.valueOf().description);
