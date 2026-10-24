// Constant text given to `Function` or `eval` that parses but has an early error (a jump without a target, a label declared twice, `super` outside a method, `delete` of a name in strict code) does not stop the build. The call stays an ordinary call and throws a SyntaxError each time it runs. The text beside it that has no error is compiled as usual.
function attempt(label, create) {
  for (let round = 0; round < 2; round++) {
    try {
      console.log(label + ":", typeof create());
    } catch (error) {
      console.log(label + ":", error.name);
    }
  }
}
function neverCalled() {
  return new Function("continue;");
}

attempt("break outside a loop", () => new Function("break"));
attempt("continue outside a loop", () => Function("continue;"));
attempt("break in a function inside a loop", () => new Function("for (;;) { (function () { break; }); }"));
attempt("break to a label that is not there", () => new Function("a: for (;;) { break b; }"));
attempt("a label declared twice", () => new Function("a: a: ;"));
attempt("super in a function body", () => new Function("super.x;"));
attempt("super in indirect eval", () => (0, eval)("super.x"));
attempt("delete of a name in strict code", () => new Function("'use strict'; delete a;"));

attempt("break inside a loop", () => new Function("for (;;) { break; }"));
attempt("continue to a label", () => new Function("a: for (;;) { continue a; }"));
attempt("delete of a name in sloppy code", () => new Function("delete a;"));
console.log(new Function("limit", "let count = 0; for (;;) { if (++count === limit) break; } return count;")(3));
console.log(typeof neverCalled);
