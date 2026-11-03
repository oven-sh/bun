function inWith(scope) {
  with (scope) {
    return [typeof Bun, typeof process, process && process.isBun ? "bun" : "other"].join();
  }
}
function behindEval(text) {
  eval(text);
  return [typeof Bun, typeof process === "undefined" ? "other" : "bun"].join();
}
console.log(inWith({}), inWith({ Bun: undefined, process: 0 }), inWith({ process: { isBun: 0 } }));
console.log(behindEval(""), behindEval("var Bun"), behindEval("var process, Bun = 1"));
