// `undefined`, `NaN` and `Infinity` cannot be changed. A written text that names them is handed to the built-in when the program runs, like every text: none of it is compiled with the program, and it answers as in plain Bun.
const isMissing = new Function("a", "return a === undefined");
console.log(isMissing(), isMissing(1), isMissing.name, isMissing.length, String(isMissing));
console.log(Function("return NaN")(), Function("return -Infinity")(), (0, eval)("undefined"), (0, eval)("NaN"));
console.log(new Function("undefined", "return undefined")(1), new Function("var NaN = 2; return NaN")());
