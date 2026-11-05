// Walks over Maps and Sets that nobody knows: with texts, numbers or both as keys, with entries deleted and added on the way, in loops too long to be copied for a Map alone.
// IR= 1 tally = MapNext
// IR= 0 tally key="done"
// CALLS- stepIterator Equal\.Strict

function tally(pairsOrMap, log) {
  let texts = "", numbers = 0, others = 0, steps = 0;
  for (const [key, value] of pairsOrMap) {
    steps++;
    if (typeof key === "string") texts += key + ":";
    else if (typeof key === "number") numbers += key;
    else others++;
    if (typeof value === "string") texts += value + ";";
    else if (typeof value === "number") numbers += value;
    else others++;
    if (log.length < 4) log.push(typeof key + "/" + typeof value);
    if (key === "stop") break;
    if (key === "throw") throw new RangeError("at step " + steps);
    if (value === "skip") continue;
    if (numbers > 1e9) numbers = 0;
    if (texts.length > 200) texts = texts.slice(-20);
  }
  return steps + " " + texts + " " + numbers + " " + others + " " + log.join(",");
}
function valuesOf(map) {
  const seen = [];
  for (const value of map.values()) seen.push(value);
  return seen.join(" ");
}
function keysOf(map) {
  const seen = [];
  for (const key of map.keys()) seen.push(typeof key + " " + String(key));
  return seen.join(", ");
}
function membersOf(set) {
  const seen = [];
  for (const member of set) seen.push(typeof member + " " + String(member));
  return seen.join(", ");
}
function walkAndChange(collection, change) {
  const seen = [];
  for (const entry of collection) {
    seen.push(String(entry));
    change(collection, seen.length);
    if (seen.length > 20) break;
  }
  return seen.join(" | ");
}

const hide = value => [value, null][JSON.parse("0")];
function say(name, run) {
  try {
    console.log(name, "->", run());
  } catch (error) {
    console.log(name, "threw", error?.constructor?.name, error?.message);
  }
}

const byText = () => new Map([["a", "x"], ["b", 2], ["c", null]]);
const byNumber = () => new Map([[1, "x"], [2.5, 2], [-0, undefined]]);
const byBoth = () => new Map([["a", 1], [2, "b"], [true, false], [null, {}], [undefined, 3n]]);

for (const [name, make] of [["texts", byText], ["numbers", byNumber], ["both", byBoth], ["none", () => new Map()]]) {
  say("tally " + name, () => tally(hide(make()), []));
  say("values " + name, () => valuesOf(hide(make())));
  say("keys " + name, () => keysOf(hide(make())));
  say("members " + name, () => membersOf(hide(new Set(make().keys()))));
  say("iterator " + name, () => membersOf(hide(make().keys())));
  say("set iterator " + name, () => membersOf(hide(new Set(make().keys()).values())));
  say("entries of a set " + name, () => tally(hide(new Set(make().keys()).entries()), []));
}

say("tally a list", () => tally(hide([["a", 1], [2, "b"], "xy", [3]]), []));
say("tally a set of pairs", () => tally(hide(new Set([["a", 1], [2, "b"]])), []));
say("tally a generator", () => tally(hide((function* () { yield ["a", 1]; yield [2, "skip"]; yield ["stop", 0]; yield ["never", 0]; })()), []));
say("tally stops", () => tally(hide(new Map([["a", 1], ["stop", 2], ["b", 3]])), []));
say("tally throws", () => tally(hide(new Map([[1, 1], ["throw", 2], ["b", 3]])), []));
say("tally undefined", () => tally(hide(undefined), []));
say("tally a number", () => tally(hide(5), []));
say("tally numbers in a list", () => tally(hide([1, 2]), []));

class Counted extends Map {
  *[Symbol.iterator]() { for (const key of super.keys()) yield [key, "counted"]; }
}
say("tally a class below Map", () => tally(hide(new Counted([["a", 1], [2, 2]])), []));
const own = new Map([["a", 1]]);
own[Symbol.iterator] = function () { return [["own", "iterator"]][Symbol.iterator](); };
say("tally a Map with its own method", () => tally(hide(own), []));

const closes = [];
const closing = { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: false, value: [n++ ? "stop" : "go", n] }), return() { closes.push("closed"); return {}; } }; } };
say("tally closes", () => tally(hide(closing), []) + " " + closes.join());

say("a number arrives among texts", () => walkAndChange(hide(new Map([["a", 1], ["b", 2]])), (map, step) => { if (step === 1) map.set(7, "seven"); }));
say("a number arrives in a set of texts", () => walkAndChange(hide(new Set(["a", "b"])), (set, step) => { if (step === 1) set.add(7.5); }));
say("texts arrive among numbers", () => walkAndChange(hide(new Set([1, 2])), (set, step) => { if (step < 3) set.add("t" + step); }));
say("the next is deleted, texts", () => walkAndChange(hide(new Set(["a", "b", "c", "d"])), (set, step) => { if (step === 1) { set.delete("b"); set.delete("c"); } }));
say("the next is deleted, numbers", () => walkAndChange(hide(new Set([1, 2, 3, 4])), (set, step) => { if (step === 1) { set.delete(2); set.delete(3); } }));
say("the next is deleted, a map by number", () => walkAndChange(hide(new Map([[1, "a"], [2, "b"], [3, "c"]])), (map, step) => { if (step === 1) map.delete(2); }));
say("deleted and added again", () => walkAndChange(hide(new Set([1, "a", 2])), (set, step) => { if (step === 1) { set.delete(1); set.add(1); } }));
say("cleared", () => walkAndChange(hide(new Map([[1, 1], [2, 2]])), (map, step) => { if (step === 1) { map.clear(); map.set("new", 0); } }));
say("grows past its table", () => walkAndChange(hide(new Set([0])), (set, step) => { if (step < 12) { set.add(step); set.add("s" + step); } }));
say("all deleted in front", () => { const set = new Set([1, 2, 3, "a"]); set.delete(1); set.delete(2); set.delete(3); return membersOf(hide(set)); });
say("all deleted", () => { const map = new Map([[1, 1], [2, 2]]); map.delete(1); map.delete(2); return valuesOf(hide(map)) + "." + tally(hide(map), []); });

const shared = hide(new Map([[1, "a"], [2, "b"], [3, "c"]]).values());
say("an iterator walked twice", () => { const first = []; for (const value of shared) { first.push(value); break; } return first + " then " + membersOf(shared) + " then " + membersOf(shared); });
