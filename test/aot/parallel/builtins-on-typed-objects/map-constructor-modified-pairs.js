const lines = [];
function describe(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") return Array.isArray(value) ? "array(" + value.length + ")" : "object(" + Object.keys(value).join() + ")";
  return typeof value + "(" + String(value) + ")";
}
function report(name, table) {
  const parts = [];
  table.forEach((value, key) => { parts.push(describe(key) + "=>" + describe(value)); });
  lines.push(name + ": " + parts.join(" | "));
}

function untouched() {
  const table = new Map([["a", { inner: { deep: 1 } }], ["b", { inner: { deep: 2 } }]]);
  report("untouched", table);
  return table.get("a").inner.deep + table.get("b").inner.deep;
}
function computed(names) {
  const table = new Map(names.map((name, index) => [name, { at: index }]));
  report("computed", table);
  let sum = 0;
  for (const name of names) sum += table.get(name).at;
  return sum;
}
function storedAtZero() {
  const pair = ["a", { v: 1 }];
  pair[0] = { k: 2 };
  report("storedAtZero", new Map([pair]));
}
function storedAtOne() {
  const pair = ["a", { v: 1 }];
  pair[1] = "text";
  const table = new Map([pair]);
  report("storedAtOne", table);
  return table.get("a").length;
}
function storedByCallee() {
  const pair = ["a", { v: 1 }];
  swap(pair);
  report("storedByCallee", new Map([pair]));
}
function swap(list) { const first = list[0]; list[0] = list[1]; list[1] = first; }
function reversed() {
  const pair = ["a", { v: 1 }];
  pair.reverse();
  report("reversed", new Map([pair]));
}
function shifted() {
  const pair = ["a", { v: 1 }];
  pair.shift();
  report("shifted", new Map([pair]));
}
function popped() {
  const pair = ["a", { v: 1 }];
  pair.pop();
  const table = new Map([pair]);
  report("popped", table);
  return table.get("a") === undefined;
}
function unshifted() {
  const pair = ["a", { v: 1 }];
  pair.unshift(7);
  report("unshifted", new Map([pair]));
}
function cut() {
  const pair = ["a", { v: 1 }];
  pair.length = 1;
  report("cut", new Map([pair]));
}
function emptied() {
  const pair = ["a", { v: 1 }];
  pair.length = 0;
  report("emptied", new Map([pair]));
}
function deleted() {
  const pair = ["a", { v: 1 }];
  delete pair[1];
  report("deleted", new Map([pair]));
}
function deletedAboveAnotherList() {
  const pair = ["a", { v: 1 }];
  delete pair[1];
  Object.setPrototypeOf(pair, ["inherited key", "inherited value"]);
  report("deletedAboveAnotherList", new Map([pair]));
}
function redefined() {
  const pair = ["a", { v: 1 }];
  Object.defineProperty(pair, 1, { get() { return 42; } });
  const table = new Map([pair]);
  report("redefined", table);
  return table.get("a") + 1;
}
function filled() {
  const pair = ["a", { v: 1 }];
  pair.fill(false);
  report("filled", new Map([pair]));
}
function sorted() {
  const pair = ["b", "a"];
  pair.sort();
  report("sorted", new Map([pair]));
}
function copiedWithin() {
  const pair = ["a", { v: 1 }];
  pair.copyWithin(0, 1);
  report("copiedWithin", new Map([pair]));
}
function spliced() {
  const pair = ["a", { v: 1 }];
  pair.splice(0, 1, 1.5, 2.5);
  report("spliced", new Map([pair]));
}
function assigned() {
  const pair = ["a", { v: 1 }];
  Object.assign(pair, { 0: "assigned" }, ["again"]);
  report("assigned", new Map([pair]));
}
function storedThroughReflect() {
  const pair = ["a", { v: 1 }];
  Reflect.set(pair, "1", 9n);
  report("storedThroughReflect", new Map([pair]));
}
function handedToUnknownCode() {
  const pair = ["a", { v: 1 }];
  globalThis.keptPair = pair;
  globalThis[["kept", "Pair"].join("")][1] = Symbol.for("stored");
  const table = new Map([pair]);
  lines.push("handedToUnknownCode: " + typeof table.get("a"));
}
function touchedWhileTheListIsGoneOver() {
  const first = ["a", { v: 1 }];
  const second = ["b", { v: 2 }];
  function* entries() {
    yield first;
    second[1] = "late";
    yield second;
  }
  report("touchedWhileTheListIsGoneOver", new Map(entries()));
}
function touchedBySetOfSubclass() {
  const second = ["b", { v: 2 }];
  class Watching extends Map {
    set(key, value) {
      second[0] = 5;
      return super.set(key, value);
    }
  }
  report("touchedBySetOfSubclass", new Watching([["a", { v: 1 }], second]));
}
function listGoneOverAnotherWay() {
  const list = [["a", { v: 1 }]];
  list[Symbol.iterator] = function* () { yield [1, 2]; };
  report("listGoneOverAnotherWay", new Map(list));
}
function longerThanAPair() {
  report("longerThanAPair", new Map([["a", { v: 1 }, "third"]]));
}
function spreadBehindThePair(rest) {
  report("spreadBehindThePair", new Map([["a", { v: 1 }, ...rest]]));
}
function holeInThePair() {
  report("holeInThePair", new Map([["a", , { v: 1 }], [, "b"]]));
}
function entriesThatAreNoLists() {
  report("entriesThatAreNoLists", new Map([{ 0: "a", 1: { v: 1 } }, { 0: "b" }, new String("xy"), function named() {}]));
}
function pairsAmongOtherEntries(flag) {
  const entry = flag ? ["a", { v: 1 }] : { 0: { k: 1 }, 1: "value" };
  report("pairsAmongOtherEntries " + flag, new Map([entry, ["c", { v: 3 }]]));
}
function copyOfATable() {
  const first = new Map();
  first.set("a", { inner: { deep: 1 } });
  first.set(2, "two");
  const second = new Map(first);
  first.set("later", true);
  report("copyOfATable", second);
  return second.get("a").inner.deep;
}
function copyOfATableGoneOverAnotherWay() {
  const first = new Map([["a", 1]]);
  first[Symbol.iterator] = function* () { yield [{ k: 1 }, { v: 1 }]; };
  report("copyOfATableGoneOverAnotherWay", new Map(first));
}
function pairsOfSteps() {
  const first = new Map([["a", { v: 1 }]]);
  const kept = [];
  for (const entry of first) kept.push(entry);
  kept[0][1] = "stored into the pair of a step";
  report("pairsOfSteps", new Map(kept));
}
function entriesOfAnObject() {
  const entries = Object.entries({ a: { v: 1 }, b: { v: 2 } });
  entries.push([3, "three"]);
  report("entriesOfAnObject", new Map(entries));
}
function numbersAsValues() {
  const table = new Map([["a", 1], ["b", 2.5], ["c", -0], ["d", NaN]]);
  report("numbersAsValues", table);
  return table.get("a") + table.get("b") + 1 / table.get("c");
}
function numbersAsKeys() {
  const table = new Map([[1, "a"], [2.5, "b"], [-0, "c"], [NaN, "d"]]);
  report("numbersAsKeys", table);
  return [...table.keys()].map(key => 1 / key).join();
}
function weak() {
  const key = { isKey: true };
  const other = { isKey: false };
  const pair = [key, { v: 1 }];
  const table = new WeakMap([pair, [other, "text"]]);
  pair[1] = "too late";
  lines.push("weak: " + describe(table.get(key)) + " " + describe(table.get(other)) + " " + describe(table.get({})));
}
function refused() {
  for (const entries of [[1], ["ab"], [null], 5, [[{}, 1]]]) {
    try { lines.push("refused: " + new Map(entries).size); } catch (error) { lines.push("refused: " + error.constructor.name); }
    try { new WeakMap(entries); lines.push("refused weak: none"); } catch (error) { lines.push("refused weak: " + error.constructor.name); }
  }
}

lines.push(String(untouched()), String(computed(["x", "y", "z"])));
storedAtZero(); lines.push(String(storedAtOne())); storedByCallee(); reversed(); shifted(); lines.push(String(popped())); unshifted(); cut(); emptied(); deleted(); deletedAboveAnotherList();
lines.push(String(redefined())); filled(); sorted(); copiedWithin(); spliced(); assigned(); storedThroughReflect(); handedToUnknownCode(); touchedWhileTheListIsGoneOver(); touchedBySetOfSubclass();
listGoneOverAnotherWay(); longerThanAPair(); spreadBehindThePair([1, 2]); holeInThePair(); entriesThatAreNoLists(); pairsAmongOtherEntries(true); pairsAmongOtherEntries(false);
lines.push(String(copyOfATable())); copyOfATableGoneOverAnotherWay(); pairsOfSteps(); entriesOfAnObject(); lines.push(String(numbersAsValues()), numbersAsKeys()); weak(); refused();
console.log(lines.join("\n"));
