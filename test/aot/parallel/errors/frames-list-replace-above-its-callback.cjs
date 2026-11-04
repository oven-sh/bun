// A callback that String.prototype.replace or replaceAll calls throws. Each row prints the frames of the error: the built-in function stands between the callback and its caller.
const framesOf = error =>
  error.stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
    .join(" | ");
function fail() {
  throw new Error("x");
}
function row(run) {
  for (let turn = 0; turn < 2; turn++) {
    try {
      run();
    } catch (error) {
      console.log(run.name + ":", framesOf(error));
    }
  }
}
row(function overExpression() {
  "a".replace(/a/, () => fail());
});
row(function overGlobalExpression() {
  "a".replace(/(a)/g, () => fail());
});
row(function overText() {
  "a".replace("a", () => fail());
});
row(function allOverExpression() {
  "a".replaceAll(/a/g, () => fail());
});
row(function allOverText() {
  "a".replaceAll("a", () => fail());
});
row(function returned() {
  "use strict";
  return "a".replace(/a/, () => fail());
});
row(function overNamedGroups() {
  "a".replace(/(?<first>a)/, (...all) => fail(all));
});
