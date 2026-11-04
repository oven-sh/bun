// The build goes both ways at a condition that only the run knows, so it goes through code that the program never runs: here, functions that call themselves without end, one by itself and one through a built-in that calls back.
// Calls go so deep and no deeper. What stands behind is reached, and both patterns have their code in the image.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpPredictedTextsGivenCode = 2
const never = process.argv.length > 99;
function down(depth) {
  return down(depth + 1) + 1;
}
function across(list) {
  return list.map(each => across([each + 1]));
}
function first(parts) {
  if (never) down(0);
  return new RegExp(parts.join(""));
}
function second(parts) {
  if (never) across([0]);
  return new RegExp(parts.join(""));
}
const made = [first(["^", "a+", "$"]), second(["^", "b+", "$"])];
console.log(made.map(pattern => pattern.source + " " + pattern.test("aaa") + " " + pattern.test("bbb")).join(" | "));
