// `undefined`, `NaN` and `Infinity` cannot be changed, so a literal text that names them is compiled like any other literal text, and nothing of the library is kept for text that the build cannot see.
// STATISTIC: ImageFunctionsEmitted <= 100
const isMissing = new Function("a", "return a === undefined");
console.log(isMissing(), isMissing(1), isMissing.name, isMissing.length, String(isMissing));
console.log(Function("return NaN")(), Function("return -Infinity")(), (0, eval)("undefined"), (0, eval)("NaN"));
console.log(new Function("undefined", "return undefined")(1), new Function("var NaN = 2; return NaN")());
