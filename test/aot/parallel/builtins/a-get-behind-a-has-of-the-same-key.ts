// `map.has(key) ? map.get(key) : other`, `if (!state.has(receiver)) throw ..; return state.get(receiver)`: one search answers both questions, in a Map and in a WeakMap.
// Every form prints what two searches print: keys of every kind, a value that is undefined, and whatever stands between the two calls and may change the table.
// STATISTIC: GetsAnsweredByHas >= 8
export {};

const lines: string[] = [];
const say = (name: string, value: unknown) => lines.push(name + ": " + String(value));
const hidden = <T>(value: T): T => [value][Number(process.argv.length > 99)]!;

const byText = new Map<string, number | undefined>([["a", 1], ["b", undefined], ["c", 0]]);
const byNumber = new Map<number, string>();
for (let k = 0; k < 40; k += 2) byNumber.set(k, "n" + k);
const first = {}, second = {}, third = {};
const byObject = new Map<object, number>([[first, 1], [second, 2]]);
const byAnything = new Map<unknown, unknown>([[NaN, "nan"], [0, "zero"], ["0", "text zero"], [null, "null"], [undefined, "undefined"], [true, false], [1.5, 2.5]]);

function conditional(map: Map<string, number | undefined>, key: string) {
  return map.has(key) ? map.get(key) : "absent";
}
function statement(map: Map<number, string>, key: number) {
  if (map.has(key)) return map.get(key);
  return "absent";
}
function turnedAway(map: Map<object, number>, key: object) {
  if (!map.has(key)) return -1;
  return map.get(key)! + 10;
}
function anything(map: Map<unknown, unknown>, key: unknown) {
  return map.has(key) ? map.get(key) : "absent";
}
function deletedBetween(map: Map<string, number | undefined>, key: string) {
  if (map.has(key)) {
    map.delete(key);
    return map.get(key);
  }
  return "absent";
}
function storedBetween(map: Map<string, number | undefined>, key: string) {
  if (map.has(key)) {
    map.set(key, 77);
    return map.get(key);
  }
  return "absent";
}
function clearedByACall(map: Map<string, number | undefined>, key: string, between: () => void) {
  if (map.has(key)) {
    between();
    return map.get(key);
  }
  return "absent";
}
function anotherKey(map: Map<string, number | undefined>, key: string, other: string) {
  return map.has(key) ? map.get(other) : "absent";
}
function anotherMap(map: Map<string, number | undefined>, other: Map<string, number | undefined>, key: string) {
  return map.has(key) ? other.get(key) : "absent";
}
function onTheOtherEdge(map: Map<string, number | undefined>, key: string) {
  return map.has(key) ? "present" : map.get(key);
}
function both(map: Map<string, number | undefined>, key: string) {
  const present = map.has(key);
  const value = present ? map.get(key) : -1;
  return String(present) + " " + String(value);
}
function askedWhateverTheAnswer(map: Map<string, number | undefined>, key: string) {
  const label = map.has(key) ? "yes" : "no";
  return label + " " + String(map.get(key));
}
function askedBehindBothArms(map: Map<string, number | undefined>, key: string) {
  let count = 0;
  if (map.has(key)) count++;
  else count--;
  return count + " " + String(map.get(key));
}
function inALoop(map: Map<number, string>, upTo: number) {
  let text = "";
  for (let k = 0; k < upTo; k++) text += map.has(k) ? map.get(k) : ".";
  return text;
}
function textsInALoop(map: Map<string, number | undefined>, keys: string[]) {
  let text = "";
  for (const key of keys) text += map.has(key) ? String(map.get(key)) : ".";
  return text;
}
class Below extends Map<string, number> {
  getOr(key: string, other: number) {
    return this.has(key) ? this.get(key)! : other;
  }
}
class WithItsOwnGet extends Map<string, number> {
  get(key: string) {
    return (super.get(key) ?? 0) + 100;
  }
  getOr(key: string, other: number) {
    return this.has(key) ? this.get(key)! : other;
  }
}

for (const key of ["a", "b", "c", "d", ""]) {
  say("conditional " + key, conditional(hidden(byText), hidden(key)));
  say("on the other edge " + key, onTheOtherEdge(hidden(byText), hidden(key)));
  say("both " + key, both(hidden(byText), hidden(key)));
  say("asked whatever the answer " + key, askedWhateverTheAnswer(hidden(byText), hidden(key)));
  say("asked behind both arms " + key, askedBehindBothArms(hidden(byText), hidden(key)));
  say("another key " + key, anotherKey(hidden(byText), hidden(key), hidden("c")));
  say("another map " + key, anotherMap(hidden(byText), hidden(new Map([["a", 5]])), hidden(key)));
}
say("a key put together", conditional(hidden(byText), hidden("x") === "x" ? ["", "a"].join("") : "b"));
for (const key of [0, 1, 2, 38, 40, -0, 2.5, NaN]) say("statement " + key, statement(hidden(byNumber), hidden(key)));
for (const key of [first, second, third]) say("turned away", turnedAway(hidden(byObject), hidden(key)));
for (const key of [NaN, 0, -0, "0", null, undefined, true, false, 1.5, 1, {}, "nan"]) say("anything " + String(key), anything(hidden(byAnything), hidden(key)));
say("deleted between", deletedBetween(new Map([["a", 1]]), hidden("a")));
say("stored between", storedBetween(new Map([["a", 1]]), hidden("a")));
const cleared = new Map<string, number | undefined>([["a", 1]]);
say("cleared by a call", clearedByACall(cleared, hidden("a"), hidden(() => cleared.clear())));
say("in a loop", inALoop(hidden(byNumber), hidden(12)));
say("texts in a loop", textsInALoop(hidden(byText), hidden(["a", "z", "b", "c", "a"])));
say("below", new Below([["a", 1]]).getOr(hidden("a"), 9) + " " + new Below([["a", 1]]).getOr(hidden("b"), 9));
say("with its own get", new WithItsOwnGet([["a", 1]]).getOr(hidden("a"), 9) + " " + new WithItsOwnGet([["a", 1]]).getOr(hidden("b"), 9));
const large = new Map<string, number>();
for (let k = 0; k < 3000; k++) large.set("key" + k, k);
let sum = 0;
for (let k = 0; k < 6000; k += 7) sum += large.has("key" + k) ? large.get("key" + k)! : -1;
say("a large map", sum);
const weak = new WeakMap<object, unknown>([[first, 1], [second, undefined]]);
function weakConditional(map: WeakMap<object, unknown>, key: any) {
  return map.has(key) ? map.get(key) : "absent";
}
function privateField(receiver: any, state: any) {
  if (!state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return state.get(receiver);
}
function weakDeletedBetween(map: WeakMap<object, unknown>, key: object) {
  if (map.has(key)) {
    map.delete(key);
    return map.get(key);
  }
  return "absent";
}
for (const key of [first, second, third, 1, "a", null, undefined, Symbol.iterator]) say("weak conditional", weakConditional(hidden(weak), hidden(key)));
for (const key of [first, second, third]) {
  try {
    say("private field", privateField(hidden(key), hidden(weak)));
  } catch (error) {
    say("private field", error);
  }
}
say("private field of a map", privateField(hidden("a"), hidden(byText)));
say("weak deleted between", weakDeletedBetween(new WeakMap([[first, 1]]), hidden(first)));
console.log(lines.join("\n"));
