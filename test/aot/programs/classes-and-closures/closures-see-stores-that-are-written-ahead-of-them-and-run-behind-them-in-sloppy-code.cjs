// As its neighbor without "in-sloppy-code", for what only sloppy code can say: the initializer of `for (var a = 0 in b)`, and `arguments` that share the parameters.
function check(name, run) {
  let shown;
  try {
    shown = String(run());
  } catch (error) {
    shown = "throws " + error;
  }
  console.log(name + ": " + shown);
}
check("for-in initializer closure", function () { var v = 1, g; for (var x = (g = () => v) in (v = 2, {})); return g(); });
check("for-in initializer store", function () { var v = 1, g; for (var x = (v = 2) in (g = () => v, {})); return g(); });
check("mapped arguments", function () { return (function (v) { const g = () => v; arguments[0] = 2; return g(); })(1); });
check("mapped arguments first", function () { return (function (v) { arguments[0] = 2; const g = () => v; return g(); })(1); });
check("sloppy pattern", function () { var v = 1, g, x; [g, x = v = 2] = [() => v]; return g(); });
check("var pattern nested", function () { var v = 1; var [[g = () => v], y = (v = 2)] = [[]]; return g(); });
module.exports = 1;
