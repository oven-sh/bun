// The list is written in front of a test, out of a name that a loop has swapped and that nothing reads behind the list; the call stands behind the test.
// STATISTIC: CallsForwardedBehindTestsOfTheirTargets >= 1
const table = { join: (one, two) => one + two, count() { return arguments.length; } };
const data = JSON.parse('{"from":0,"turns":3,"names":["join","count"]}');
function pick(first, second, from, turns, target) {
  for (let i = from; i < turns; i++) { const kept = first; first = second; second = kept; }
  const list = [first, "x"];
  if (turns > 1) return Reflect.apply(target, null, list);
  return "none";
}
globalThis.handed = [pick];
for (const name of data.names) console.log(pick("a" + data.turns, "b", data.from, data.turns, table[name]), pick("a", "b", data.from, 1, table[name]));
