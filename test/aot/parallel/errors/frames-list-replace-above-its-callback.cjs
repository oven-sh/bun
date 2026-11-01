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
/* Output:
overExpression: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:21:26) | at replace (unknown) | at overExpression (frames-list-replace-above-its-callback.cjs:21:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:20:1)
overExpression: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:21:26) | at replace (unknown) | at overExpression (frames-list-replace-above-its-callback.cjs:21:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:20:1)
overGlobalExpression: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:24:29) | at replace (unknown) | at overGlobalExpression (frames-list-replace-above-its-callback.cjs:24:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:23:1)
overGlobalExpression: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:24:29) | at replace (unknown) | at overGlobalExpression (frames-list-replace-above-its-callback.cjs:24:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:23:1)
overText: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:27:26) | at replace (unknown) | at overText (frames-list-replace-above-its-callback.cjs:27:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:26:1)
overText: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:27:26) | at replace (unknown) | at overText (frames-list-replace-above-its-callback.cjs:27:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:26:1)
allOverExpression: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:30:30) | at replaceAll (unknown) | at allOverExpression (frames-list-replace-above-its-callback.cjs:30:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:29:1)
allOverExpression: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:30:30) | at replaceAll (unknown) | at allOverExpression (frames-list-replace-above-its-callback.cjs:30:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:29:1)
allOverText: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:33:29) | at replaceAll (unknown) | at allOverText (frames-list-replace-above-its-callback.cjs:33:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:32:1)
allOverText: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:33:29) | at replaceAll (unknown) | at allOverText (frames-list-replace-above-its-callback.cjs:33:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:32:1)
returned: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at replace (unknown) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:35:1)
returned: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at replace (unknown) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:35:1)
overNamedGroups: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:40:42) | at replace (unknown) | at overNamedGroups (frames-list-replace-above-its-callback.cjs:40:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:39:1)
overNamedGroups: at fail (frames-list-replace-above-its-callback.cjs:9:13) | at <anonymous> (frames-list-replace-above-its-callback.cjs:40:42) | at replace (unknown) | at overNamedGroups (frames-list-replace-above-its-callback.cjs:40:7) | at row (frames-list-replace-above-its-callback.cjs:14:7) | at <anonymous> (frames-list-replace-above-its-callback.cjs:39:1)
*/
