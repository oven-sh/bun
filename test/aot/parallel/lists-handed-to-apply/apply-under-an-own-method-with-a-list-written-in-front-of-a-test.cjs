// `target.apply` is Function.prototype's or a method of the target's own: the own method shows the list that is made again for the call as written.
const targets = [(one, two) => one + two, { apply(self, list) { return "own:" + list.length + ":" + list.join("|") + ":" + Array.isArray(list); } }];
const data = JSON.parse('{"from":0,"turns":3}');
function pick(first, second, from, turns, target) {
  for (let i = from; i < turns; i++) { const kept = first; first = second; second = kept; }
  const list = [first, "x"];
  if (turns > 1) return target.apply(null, list);
  return "none";
}
globalThis.handed = [pick];
for (const target of targets) console.log(pick("a", "b", data.from, data.turns, target), pick("a", "b", data.from, 1, target));
