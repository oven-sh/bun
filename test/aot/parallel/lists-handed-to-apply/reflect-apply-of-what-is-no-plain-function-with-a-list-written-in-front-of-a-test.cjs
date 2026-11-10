// The rare road takes the list that is made again for it: a proxy's handler shows what it holds, and what is no function throws as ever.
// STATISTIC: CallsForwardedBehindTestsOfTheirTargets >= 1
const join = (one, two) => one + two;
const shown = new Proxy(join, { apply(target, self, list) { return "shown:" + list.length + ":" + list.join("|") + ":" + Array.isArray(list); } });
const targets = [join, shown, join.bind(null, "bound"), { no: "function" }, undefined];
const data = JSON.parse('{"from":0,"turns":3}');
function pick(first, second, from, turns, target) {
  for (let i = from; i < turns; i++) { const kept = first; first = second; second = kept; }
  const list = [first, "x"];
  if (turns > 1) return Reflect.apply(target, null, list);
  return "none";
}
globalThis.handed = [pick];
for (const target of targets) {
  try { console.log(pick("a", "b", data.from, data.turns, target)); } catch (error) { console.log(error.constructor.name); }
}
