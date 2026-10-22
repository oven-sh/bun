// Constant text given to `Function` or `eval` that does not parse, or that has an early error, does not stop the build: the call stays an ordinary call and throws its SyntaxError when it runs, and only then.
function attempt(label, f) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", e.name); }
}
function neverCalled() { return new Function("return (")(); }

attempt("new Function, a body that does not parse", () => new Function("return ("));
attempt("Function without new", () => Function("a b c"));
attempt("parameters that do not parse", () => new Function("a b", "return a"));
attempt("a name declared twice", () => new Function("let a; let a;"));
attempt("break outside a loop", () => new Function("break;"));
attempt("indirect eval", () => (0, eval)("1 +"));
attempt("direct eval", () => eval("var ;"));
attempt("direct eval, a name declared twice", () => eval("let b; let b;"));
attempt("new Function, a body that parses", () => new Function("return 1 + 1")());
attempt("direct eval of text that parses", () => eval("1 + 1"));
attempt("a function that holds such a call and is never called", () => typeof neverCalled);
if (process.argv.length > 100) eval(") (");
console.log("the end is reached");
