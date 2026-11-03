// The compiler sees no place where this program evaluates text that is made at run time, and counts on it. An evaluator that the program reaches in a way the compiler cannot follow throws, and the error says what to write instead. Constant text is compiled with the program. closed-world/evaluators-admitted is the same program built with --compile-inspector.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  const isRefusal = message.includes("the compiler couldn't tell at build time") || error.code === "ERR_CODE_NOT_COMPILED" || message.includes("bun compile differs from bun run here");
  return isRefusal ? "refused: " + message.replace(/'.*?'/, "'..'") : error.name;
}
function attempt(label, action) {
  try { console.log(label + ": " + action()); } catch (error) { console.log(label + ": " + outcome(error)); }
}
const text = decoded("1 + 1");
const realm = unknown(globalThis);
const constructorOf = value => unknown(value)[decoded("constructor")];

attempt("constant text given to eval", () => (0, eval)("1 + 1"));
attempt("constant text given to Function", () => new Function("a", "return a + 1")(1));
attempt("eval", () => realm[decoded("eval")](text));
attempt("Function", () => realm[decoded("Function")]("return " + text)());
attempt("the constructor of the constructor of an object", () => constructorOf(constructorOf({}))("return " + text)());
attempt("AsyncFunction", () => typeof constructorOf(async function () {})(text));
attempt("GeneratorFunction", () => typeof constructorOf(function* () {})(text));
attempt("AsyncGeneratorFunction", () => typeof constructorOf(async function* () {})(text));
attempt("a string given to setTimeout", () => setTimeout(text));
/* Output:
constant text given to eval: 2
constant text given to Function: 2
eval: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
Function: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
the constructor of the constructor of an object: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
AsyncFunction: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
GeneratorFunction: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
AsyncGeneratorFunction: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
a string given to setTimeout: TypeError
*/
