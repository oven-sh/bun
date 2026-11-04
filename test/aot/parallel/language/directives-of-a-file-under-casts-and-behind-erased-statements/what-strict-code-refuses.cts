<any>"use strict";
const frozen = Object.freeze({ retries: 3 });
function attempt(what: string, run: () => unknown) {
  try {
    console.log(what + ":", run());
  } catch (error) {
    console.log(what + ":", (error as Error).name);
  }
}
attempt("a store to a frozen object", () => ((frozen as { retries: number }).retries = 5));
// @ts-ignore
attempt("a store to a name that nobody declares", () => (nobodyDeclaresThis = 1));
attempt("arguments.callee", function () {
  return typeof arguments.callee;
});
attempt("text that is evaluated", () => eval("(function () { return this === undefined ? 'strict' : 'sloppy'; })()"));
attempt("an octal escape in text that is evaluated", () => eval('"\\01"').length);
attempt("a function made of text", () => new Function("return this === undefined ? 'strict' : 'sloppy';")());
