// Loose equality in a loop: strings, integers and cells are told apart without converting anything.
// STATISTIC: LooseEqualitiesOpened >= 1
function indexOf(list, x) {
  for (var i = 0; i < list.length; i++) if (list[i] == x) return i;
  return -1;
}
let converted = 0;
const object = { toString() { converted++; return "text"; } };
const symbol = Symbol("s");
const values = ["a", "b", "ab", "a" + "b", "", " ", "0", "1", 0, 1, -0, 1.5, "1.5", NaN, "NaN", null, undefined, true, false, 1n, "1n", 2n, object, symbol, [], [1], ["a"], new String("a"), new Number(1), "é", "日本", "日" + "本", "x".repeat(40), "x".repeat(39) + "y", ["x".repeat(20), "x".repeat(20)].join("")];
const log = [];
for (const x of values) {
  const found = [];
  for (const list of [values, ["a", "b", "c", "text", "ab"], [1, 2, 3, "1"], [object, symbol, null], ["x".repeat(40), "日本"]]) found.push(indexOf(list, x));
  log.push(found.join());
}
const holes = [, "a", , undefined];
log.push(indexOf(holes, undefined), indexOf(holes, null), indexOf(holes, "a"), converted);
let rope = "";
for (let i = 0; i < 30; i++) rope += String.fromCharCode(97 + (i % 3));
log.push(indexOf(["abcabcabcabcabcabcabcabcabcabc", rope], rope), indexOf([rope + "!"], rope + "!"));
console.log(log.join("\n"));
