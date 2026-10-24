// Typed code reads elements of a `number[]` that are not there: at -1, 1.5, the length, past it, 2 ** 32, NaN, Infinity, and at holes, with nothing behind the hole or with a number, a text, undefined or a getter on a prototype that replaced `Array.prototype`, and with properties named like those keys on the array or on its prototype. Each read is used in one way: in arithmetic, beside a text, compared, tested for absence, returned, handed on, stored, taken apart by a pattern, iterated, added up in a loop. Every result is plain Bun's, what stands around the read runs once and in order, and a getter is called once for a read. At the end come arrays with holes that only typed code ever sees.
// STATISTIC: ElementPresenceTestsPlaced >= 10
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function list(a: unknown[]): string {
  if (a.length > 32) return a.length + " long {" + Object.keys(a).map(key => key + "=" + show((a as unknown as Record<string, unknown>)[key])).join(" ") + "}";
  let text = "[";
  for (let i = 0; i < a.length; i++) text += (i > 0 ? " " : "") + (Object.hasOwn(a, i) ? show(a[i]) : "hole");
  text += "]";
  for (const key of Object.keys(a)) if (String(Number(key) >>> 0) !== key || key === "4294967295") text += " " + key + "=" + show((a as unknown as Record<string, unknown>)[key]);
  return text;
}

let events = "";
function attempt(run: () => string): string {
  let text: string;
  try {
    text = run();
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  if (events !== "") text += " (" + events.trim() + ")";
  events = "";
  return text;
}

// "NaN ; NaN ; NaN ; 1" becomes "NaN*3 ; 1".
function inRuns(parts: string[]): string {
  let text = "";
  for (let i = 0; i < parts.length; ) {
    let end = i + 1;
    while (end < parts.length && parts[end] === parts[i]) end++;
    text += (i > 0 ? " ; " : "") + parts[i] + (end - i > 1 ? "*" + (end - i) : "");
    i = end;
  }
  return text;
}

function twice(run: () => unknown): string {
  return attempt(() => {
    const first = show(run()), second = show(run());
    return first === second ? first : first + " then " + second;
  });
}

const nan = Number(JSON.parse('"x"'));

// One read, one use.
function timesTwo(a: number[], k: number): number { return a[k] * 2; }
function plusOne(a: number[], k: number): number { return a[k] + 1; }
function tenMinus(a: number[], k: number): number { return 10 - a[k]; }
function dividedBy(a: number[], k: number): number { return 1 / a[k]; }
function negated(a: number[], k: number): number { return -a[k]; }
function madeNumber(a: number[], k: number): number { return +a[k]; }
function madeInteger(a: number[], k: number): number { return a[k] | 0; }
function shifted(a: number[], k: number): number { return a[k] >>> 1; }
function inverted(a: number[], k: number): number { return ~a[k]; }
function besideText(a: number[], k: number): string { return "<" + a[k] + ">"; }
function inTemplate(a: number[], k: number): string { return `<${a[k]}>`; }
function lessThanTwo(a: number[], k: number): boolean { return a[k] < 2; }
function notLessThanTwo(a: number[], k: number): boolean { return !(a[k] < 2); }
function atLeastTwo(a: number[], k: number): boolean { return a[k] >= 2; }
function branchOnLess(a: number[], k: number): string { if (a[k] < 2) return "less"; return "not less"; }
function equalsItself(a: number[], k: number): boolean { const value = a[k]; return value === value; }
function equalsNumber(a: number[], k: number): boolean { return a[k] === 2.5; }
function differsFromNumber(a: number[], k: number): boolean { return a[k] !== 2.5; }
function looselyEqualsNull(a: number[], k: number): boolean { return a[k] == null; }
function isUndefined(a: number[], k: number): boolean { return a[k] === undefined; }
function isNotUndefined(a: number[], k: number): string { return a[k] !== undefined ? "there" : "absent"; }
function orDefault(a: number[], k: number): number { return a[k] ?? -7; }
function orOther(a: number[], k: number): number { return a[k] || -8; }
function andOther(a: number[], k: number): number { return a[k] && -9; }
function isTruthy(a: number[], k: number): string { return a[k] ? "yes" : "no"; }
function isFalsy(a: number[], k: number): boolean { return !a[k]; }
function typeName(a: number[], k: number): string { return typeof a[k]; }
function returned(a: number[], k: number): number { return a[k]; }
function handedOn(a: number[], k: number): string { return show(a[k]); }
function handedToTyped(a: number[], k: number): number { return half(a[k]); }
function half(value: number): number { return value / 2; }
function keptInVariables(a: number[], k: number): string { const value: number = a[k]; const copy = value; return show(copy) + " " + show(value + 1); }
function usedTwice(a: number[], k: number): string { const value = a[k]; return value * 2 + "/" + value; }
function roundedDown(a: number[], k: number): number { return Math.floor(a[k]); }
function largerOf(a: number[], k: number): number { return Math.max(a[k], 1); }
function convertedToText(a: number[], k: number): string { return String(a[k]); }
function asMethodReceiver(a: number[], k: number): string { return a[k].toFixed(1); }
function chased(a: number[], k: number): number { k = a[k]; k = a[k]; return k; }
function twoNeighbors(a: number[], k: number): number { return a[k] + a[k + 1]; }
function sameTwice(a: number[], k: number): number { return a[k] * a[k]; }
function presentThenRead(a: number[], k: number): number { return k in a ? a[k] : -1; }
function belowLengthThenRead(a: number[], k: number): number { return k < a.length ? a[k] : -1; }
function insideThenRead(a: number[], k: number): number { return k >= 0 && k < a.length ? a[k] * 2 : -1; }
function storedIntoLiteral(a: number[], k: number): string { return list([a[k], 0.5]); }
function storedIntoObject(a: number[], k: number): string { const holder = { value: 0.5 }; holder.value = a[k]; return show(holder.value); }

const keyedUses: [string, (a: number[], k: number) => unknown][] = [
  ["* 2", timesTwo], ["+ 1", plusOne], ["10 -", tenMinus], ["1 /", dividedBy], ["-", negated], ["+", madeNumber], ["| 0", madeInteger], [">>> 1", shifted], ["~", inverted],
  ["beside a text", besideText], ["in a template", inTemplate],
  ["< 2", lessThanTwo], ["!(< 2)", notLessThanTwo], [">= 2", atLeastTwo], ["if (< 2)", branchOnLess], ["equals itself", equalsItself], ["=== 2.5", equalsNumber], ["!== 2.5", differsFromNumber],
  ["== null", looselyEqualsNull], ["=== undefined", isUndefined], ["!== undefined", isNotUndefined], ["?? -7", orDefault], ["|| -8", orOther], ["&& -9", andOther], ["? :", isTruthy], ["!", isFalsy], ["typeof", typeName],
  ["returned", returned], ["handed on", handedOn], ["handed to a typed function", handedToTyped], ["kept in variables", keptInVariables], ["used twice", usedTwice],
  ["Math.floor", roundedDown], ["Math.max", largerOf], ["String", convertedToText], [".toFixed", asMethodReceiver],
  ["chased", chased], ["two neighbors", twoNeighbors], ["the same twice", sameTwice],
  ["in, then read", presentThenRead], ["below the length, then read", belowLengthThenRead], ["inside, then read", insideThenRead],
  ["stored into a literal", storedIntoLiteral], ["stored into an object", storedIntoObject],
];

// The read is part of a store to the same array, or its value goes into another one.
function incremented(a: number[], k: number): number { return a[k]++; }
function preDecremented(a: number[], k: number): number { return --a[k]; }
function addedTo(a: number[], k: number): number { return (a[k] += 1.5); }
function defaulted(a: number[], k: number): number { return (a[k] ??= 6.5); }
function movedToFront(a: number[], k: number): number { return (a[0] = a[k]); }
function pushedBack(a: number[], k: number): number { return a.push(a[k]); }
function swapped(a: number[], k: number): number { const kept = a[k]; a[k] = a[0]; a[0] = kept; return kept; }

const storingUses: [string, (a: number[], k: number) => unknown][] = [
  ["++", incremented], ["--", preDecremented], ["+= 1.5", addedTo], ["??= 6.5", defaulted], ["moved to the front", movedToFront], ["pushed back", pushedBack], ["swapped with the first", swapped],
];

// The whole array.
function takenApart(a: number[]): string { const [p, q, r, s, t] = a; return show(p) + " " + show(q) + " " + show(r) + " " + show(s) + " " + show(t); }
function takenApartForArithmetic(a: number[]): number { const [p, q, r] = a; return p + q * r; }
function takenApartWithDefaults(a: number[]): string { const [p = -1, q = -2, r = -3, s = -4, t = -5] = a; return p + " " + q + " " + r + " " + s + " " + t; }
function takenApartWithRest(a: number[]): string { const [p, ...others] = a; return show(p) + " " + list(others); }
function takenApartSkipping(a: number[]): string { const [, q, , , t] = a; return show(q) + " " + show(t); }
function iteratedForSum(a: number[]): string { let total = 0, bits = 0; for (const value of a) { total += value; bits = (bits << 1) ^ (value * 4); } return show(total) + " " + bits; }
function iteratedForText(a: number[]): string { let text = ""; for (const value of a) text += value + ","; return text; }
function iteratedForAbsence(a: number[]): number { let absent = 0; for (const value of a) if (value === undefined) absent++; return absent; }
function iteratedWithIndexes(a: number[]): string { let text = ""; for (const [i, value] of a.entries()) text += i + ":" + value + ","; return text; }
function spreadOut(a: number[]): string { return list([...a]); }
function spreadIntoCall(a: number[]): number { return Math.max(...a); }
function visited(a: number[]): string { let text = ""; a.forEach(value => { text += value + ","; }); return text; }
function reduced(a: number[]): number { return a.reduce((total, value) => total + value, 0); }
function joined(a: number[]): string { return a.join("-"); }
function sumWithin(a: number[]): string { let total = 0, bits = 0; for (let i = 0; i < a.length; i++) { total += a[i]; bits = (bits << 1) ^ (a[i] * 4); } return show(total) + " " + bits; }
function onlySum(a: number[]): number { let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; return total; }
function onlyXor(a: number[]): number { let bits = 0; for (let i = 0; i < a.length; i++) bits ^= a[i]; return bits; }
function onlyProduct(a: number[]): number { let product = 1; for (let i = 0; i < a.length; i++) product *= a[i]; return product; }
function sumPastTheEnd(a: number[]): string { let total = 0, bits = 0; for (let i = 0; i < a.length + 2; i++) { total += a[i]; bits = (bits << 1) ^ (a[i] * 4); } return show(total) + " " + bits; }
function sumFromBelowZero(a: number[]): string { let total = 0, bits = 0; for (let i = -2; i < a.length; i++) { total += a[i]; bits = (bits << 1) ^ (a[i] * 4); } return show(total) + " " + bits; }
function sumBackwards(a: number[]): string { let total = 0, bits = 0; for (let i = a.length; i >= -1; i--) { total += a[i]; bits = (bits << 1) ^ (a[i] * 4); } return show(total) + " " + bits; }
function sumByHalves(a: number[]): string { let total = 0, bits = 0; for (let i = 0; i < a.length; i += 0.5) { total += a[i]; bits = (bits << 1) ^ (a[i] * 4); } return show(total) + " " + bits; }
function textWithin(a: number[]): string { let text = ""; for (let i = 0; i < a.length; i++) text += a[i]; return text; }
function textPastTheEnd(a: number[]): string { let text = ""; for (let i = -1; i <= a.length; i++) text += a[i] + ","; return text; }
function differences(a: number[]): string { let bits = 0; for (let i = 0; i < a.length; i++) bits = (bits << 2) ^ ((a[i + 1] - a[i]) * 4); return String(bits); }
function countLess(a: number[]): number { let count = 0; for (let i = 0; i <= a.length; i++) if (a[i] < 2) count++; return count; }
function countNotLess(a: number[]): number { let count = 0; for (let i = 0; i <= a.length; i++) if (!(a[i] < 2)) count++; return count; }
function largest(a: number[]): number { let most = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > most) most = a[i]; return most; }
function largestByMath(a: number[]): number { let most = -Infinity; for (let i = 0; i < a.length; i++) most = Math.max(most, a[i]); return most; }
function countAbsent(a: number[]): number { let absent = 0; for (let i = 0; i <= a.length; i++) if (a[i] === undefined) absent++; return absent; }
function sumOfPresent(a: number[]): number { let total = 0; for (let i = 0; i <= a.length; i++) { const value = a[i]; if (value !== undefined) total += value; } return total; }
function sumWithDefaults(a: number[]): number { let total = 0; for (let i = 0; i <= a.length; i++) total += a[i] ?? 100; return total; }
function copiedByPush(a: number[]): string { const copy: number[] = []; for (let i = 0; i < a.length; i++) copy.push(a[i]); return list(copy); }
function copiedByStore(a: number[]): string { const copy: number[] = []; for (let i = 0; i < a.length; i++) copy[i] = a[i]; return list(copy); }
function returnedFromLoop(a: number[]): number { for (let i = 0; i <= a.length; i++) if (i === 1) return a[i]; return -1; }
function doubledInPlace(a: number[]): string { for (let i = 0; i < a.length; i++) a[i] = a[i] * 2; return list(a); }
function bumpedInPlace(a: number[]): string { for (let i = 0; i < a.length; i++) a[i]++; return list(a); }

const wholeUses: [string, (a: number[]) => unknown][] = [
  ["taken apart", takenApart], ["taken apart for arithmetic", takenApartForArithmetic], ["taken apart with defaults", takenApartWithDefaults], ["taken apart with a rest", takenApartWithRest], ["taken apart, some skipped", takenApartSkipping],
  ["iterated for a sum", iteratedForSum], ["iterated for a text", iteratedForText], ["iterated for absence", iteratedForAbsence], ["iterated with indexes", iteratedWithIndexes],
  ["spread", spreadOut], ["spread into a call", spreadIntoCall], ["forEach", visited], ["reduce", reduced], ["join", joined],
  ["sum and bits", sumWithin], ["sum", onlySum], ["xor", onlyXor], ["product", onlyProduct], ["sum past the end", sumPastTheEnd], ["sum from below zero", sumFromBelowZero], ["sum backwards", sumBackwards], ["sum by halves", sumByHalves],
  ["text", textWithin], ["text past the end", textPastTheEnd], ["differences", differences], ["count less", countLess], ["count not less", countNotLess], ["largest", largest], ["largest by Math.max", largestByMath],
  ["count absent", countAbsent], ["sum of present", sumOfPresent], ["sum with defaults", sumWithDefaults], ["copied by push", copiedByPush], ["copied by store", copiedByStore], ["returned from a loop", returnedFromLoop],
  ["doubled in place", doubledInPlace], ["bumped in place", bumpedInPlace],
];

function over(a: number[], prototype: object): number[] {
  Object.setPrototypeOf(a, prototype);
  return a;
}

function changed(a: number[], change: (a: number[]) => void): number[] {
  change(a);
  return a;
}

const names = ["-1", "1.5", "NaN", "4294967296", "4294967295", "2147483648.5", "Infinity", "-Infinity", "1e+21", "undefined"];
function named(target: object): object {
  for (const name of names) (target as Record<string, unknown>)[name] = "named " + name;
  return target;
}

class Gapped extends Array<number> {}
(Gapped.prototype as unknown as Record<string, unknown>)["1"] = 72;

const logging: ProxyHandler<number[]> = {
  get(target, key, receiver) {
    events += " get:" + String(key);
    return Reflect.get(target, key, receiver);
  },
  has(target, key) {
    events += " has:" + String(key);
    return Reflect.has(target, key);
  },
  set(target, key, value, receiver) {
    events += " set:" + String(key);
    return Reflect.set(target, key, value, receiver);
  },
};

const arrays: [string, () => number[]][] = [
  ["fractions", () => [0.5, 1.5, 2.5, 3.5]],
  ["whole numbers", () => [1, 2, 3, 4]],
  ["parsed whole numbers", () => JSON.parse("[1,2,3,4]") as number[]],
  ["held a text once", () => changed(["x", 1.5, 2.5, 3.5] as unknown[] as number[], a => (a[0] = 0.5))],
  ["fractions, a hole", () => [0.5, , 2.5, 3.5] as number[]],
  ["whole numbers, a hole", () => [1, , 3, 4] as number[]],
  ["parsed whole numbers, a hole", () => changed(JSON.parse("[1,2,3,4]") as number[], a => delete a[1])],
  ["held a text once, a hole", () => changed(["x", 1.5, 2.5, 3.5] as unknown[] as number[], a => ((a[0] = 0.5), delete a[1]))],
  ["a hole at the end", () => changed([0.5, 1.5, 2.5], a => (a.length = 4))],
  ["only holes", () => new Array<number>(4)],
  ["empty", () => []],
  ["undefined stored", () => [0.5, undefined as unknown as number, 2.5, 3.5]],
  ["NaN stored", () => [0.5, nan, 2.5, 3.5]],
  ["indexes of itself", () => [1, 2, 3, 0]],
  ["indexes of itself, a hole", () => [2, , 3, 1] as number[]],
  ["a hole over a number", () => over([0.5, , 2.5, 3.5] as number[], { __proto__: Array.prototype, 1: 70 })],
  ["a hole over a text", () => over([0.5, , 2.5, 3.5] as number[], { __proto__: Array.prototype, 1: "up" })],
  ["a hole over undefined", () => over([0.5, , 2.5, 3.5] as number[], { __proto__: Array.prototype, 1: undefined })],
  ["a hole over a getter", () => over([0.5, , 2.5, 3.5] as number[], { __proto__: Array.prototype, get 1() { events += " getter"; return 71; } })],
  ["a hole over a number two prototypes up", () => over([0.5, , 2.5, 3.5] as number[], { __proto__: { __proto__: Array.prototype, 1: 73 } })],
  ["whole numbers, a hole over a number", () => over([1, , 3, 4] as number[], { __proto__: Array.prototype, 1: 70 })],
  ["parsed whole numbers, a hole over a number", () => over(changed(JSON.parse("[1,2,3,4]") as number[], a => delete a[1]), { __proto__: Array.prototype, 1: 70 })],
  ["no hole over a number", () => over([0.5, 1.5, 2.5, 3.5], { __proto__: Array.prototype, 1: 70 })],
  ["another prototype without elements", () => over([0.5, , 2.5, 3.5] as number[], { __proto__: Array.prototype })],
  ["elements past the end on the prototype", () => over([0.5, 1.5, 2.5, 3.5], { __proto__: Array.prototype, 4: 74, 5: "five", 9: 79 })],
  ["names on the prototype", () => over([0.5, 1.5, 2.5, 3.5], named({ __proto__: Array.prototype }))],
  ["own names", () => named([0.5, 1.5, 2.5, 3.5]) as number[]],
  ["own names on whole numbers", () => named(JSON.parse("[1,2,3,4]")) as number[]],
  ["no prototype", () => over([0.5, , 2.5, 3.5] as number[], null as unknown as object)],
  ["frozen, a hole", () => changed([0.5, , 2.5, 3.5] as number[], a => Object.freeze(a))],
  ["sealed, a hole", () => changed([0.5, , 2.5, 3.5] as number[], a => Object.seal(a))],
  ["an own getter at 1", () => changed([0.5, 1.5, 2.5, 3.5], a => Object.defineProperty(a, 1, { get() { events += " getter"; return 75; }, enumerable: true, configurable: true }))],
  ["was sparse, a hole", () => changed([0.5, , 2.5, 3.5] as number[], a => ((a[1000000] = 1), (a.length = 4)))],
  ["a subclass, a hole over its prototype's number", () => changed(new Gapped(), a => (a.push(0.5, 1.5, 2.5, 3.5), delete a[1]))],
  ["a proxy, a hole", () => new Proxy([0.5, , 2.5, 3.5] as number[], logging)],
];

const keys = [0, 1, 3, 4, 5, 9, -1, 1.5, -0, NaN, 4294967296, 4294967295, 4294967294, 2147483648, 2147483648.5, Infinity, -Infinity, 1e21];
const keysToStoreAt = [0, 1, 3, 4, 5, -1, 1.5, -0, NaN, 4294967295, 4294967294];
console.log("keys: " + keys.map(show).join(" "));
console.log("keys to store at: " + keysToStoreAt.map(show).join(" "));

for (const [name, make] of arrays) {
  for (const [use, run] of keyedUses) {
    const a = make();
    console.log(name + " | " + use + ": " + inRuns(keys.map(k => twice(() => run(a, k)))));
  }
  for (const [use, run] of storingUses) {
    console.log(name + " | " + use + ": " + keysToStoreAt.map(k => {
      const a = make();
      return attempt(() => show(run(a, k))) + " " + attempt(() => list(a));
    }).join(" ; "));
  }
  for (const [use, run] of wholeUses) {
    const a = make();
    console.log(name + " | " + use + ": " + twice(() => run(a)));
  }
}

// What stands around a read that finds nothing runs once, in order, and keeps its values.
function note(label: string, value: number): number {
  events += " " + label;
  return value;
}

function betweenCalls(a: number[], k: number): number {
  return note("x", 1) + a[k] * note("y", 2) + a[k + 1] - note("z", 3);
}

function betweenCounts(a: number[], wanted: number[]): string {
  let count = 0, total = 0, bits = 0, text = "";
  const state = { reads: 0, last: 0.5 };
  for (const k of wanted) {
    count++;
    state.reads += 1;
    text += k + ":";
    const value = a[k];
    total += value;
    bits = (bits << 1) ^ (value * 4);
    state.last = k;
    count += 10;
  }
  return count + " " + show(total) + " " + bits + " " + text + " " + state.reads + " " + show(state.last);
}

function insideTry(a: number[], k: number): string {
  let steps = "";
  try {
    steps += "a";
    const value = a[k] * 2;
    steps += "b";
    return steps + show(value);
  } finally {
    events += " finally";
  }
}

function argumentsInOrder(a: number[], k: number): string {
  return three(note("first", 1), a[k], note("third", 3));
}
function three(first: number, second: number, third: number): string {
  return show(first) + " " + show(second) + " " + show(third);
}

for (const [name, make] of arrays) {
  console.log(name + " | between calls: " + inRuns([0, 1, 3, 4, -1, 1.5].map(k => attempt(() => show(betweenCalls(make(), k))))));
  console.log(name + " | between counts: " + attempt(() => betweenCounts(make(), [0, 1, 2, 4, 3, -1, 2, 1.5, 0])));
  console.log(name + " | inside try: " + [0, 1, 4].map(k => attempt(() => insideTry(make(), k))).join(" ; "));
  console.log(name + " | arguments in order: " + [0, 1, 4].map(k => attempt(() => argumentsInOrder(make(), k))).join(" ; "));
}

// A loop that has met no hole yet, or only holes with nothing behind them, when a callee changes that.
function sumWhile(a: number[], when: number, act: (a: number[]) => void): string {
  let total = 0, bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) act(a);
    total += a[i];
    bits = (bits << 1) ^ (a[i] * 4);
  }
  return show(total) + " " + bits;
}

function xorWhile(a: number[], when: number, act: (a: number[]) => void): number {
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    if (i === when) act(a);
    bits ^= a[i];
  }
  return bits;
}

function textWhile(a: number[], when: number, act: (a: number[]) => void): string {
  let text = "";
  for (let i = 0; i < a.length; i++) {
    if (i === when) act(a);
    text += a[i] + ",";
  }
  return text;
}

const acts: [string, (a: number[]) => void][] = [
  ["nothing", () => {}],
  ["a hole ahead", a => { delete a[4]; }],
  ["a prototype with a number behind the hole ahead", a => { Object.setPrototypeOf(a, { __proto__: Array.prototype, 3: 30, 4: 40 }); }],
  ["a prototype with a text behind the hole ahead", a => { Object.setPrototypeOf(a, { __proto__: Array.prototype, 3: "up" }); }],
  ["a prototype with a getter behind the hole ahead", a => { Object.setPrototypeOf(a, { __proto__: Array.prototype, get 3() { events += " getter"; return 31; } }); }],
  ["a hole ahead and a prototype behind it", a => { delete a[4]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 4: 40 }); }],
  ["the hole ahead filled", a => { a[3] = 3.5; }],
  ["a shorter length", a => { a.length = 3; }],
];
const walked: [string, () => number[]][] = [
  ["fractions", () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]],
  ["fractions, a hole at 3", () => [0.5, 1.5, 2.5, , 4.5, 5.5] as number[]],
  ["fractions, holes at 1 and 3", () => [0.5, , 2.5, , 4.5, 5.5] as number[]],
  ["parsed whole numbers", () => JSON.parse("[1,2,3,4,5,6]") as number[]],
  ["parsed whole numbers, a hole at 3", () => changed(JSON.parse("[1,2,3,4,5,6]") as number[], a => delete a[3])],
];
for (const [name, make] of walked) {
  for (const [what, act] of acts) {
    console.log(name + " | " + what + ": " + [0, 2, 3].map(when => attempt(() => sumWhile(make(), when, act)) + " " + attempt(() => show(xorWhile(make(), when, act))) + " " + attempt(() => textWhile(make(), when, act))).join(" ; "));
  }
}

// Arrays with holes that only typed code ever sees: nothing but the functions below reads them, and only numbers and texts leave.
function ownSum(a: number[]): number { let total = 0; for (let i = 0; i < a.length; i++) total += a[i]; return total; }
function ownXor(a: number[]): number { let bits = 0; for (let i = 0; i < a.length; i++) bits ^= a[i] * 4; return bits; }
function ownOrder(a: number[]): number { let bits = 0; for (let i = 0; i < a.length; i++) bits = (bits << 1) ^ (a[i] * 4); return bits; }
function ownPastBothEnds(a: number[]): number { let bits = 0; for (let i = -1; i <= a.length; i++) bits = (bits << 1) ^ (a[i] * 4); return bits; }
function ownCountLess(a: number[]): number { let count = 0; for (let i = 0; i < a.length; i++) if (a[i] < 2) count++; return count; }
function ownCountNotLess(a: number[]): number { let count = 0; for (let i = 0; i < a.length; i++) if (!(a[i] < 2)) count++; return count; }
function ownCountAbsent(a: number[]): number { let count = 0; for (let i = 0; i < a.length; i++) if (a[i] === undefined) count++; return count; }
function ownCountPresent(a: number[]): number { let count = 0; for (let i = 0; i < a.length; i++) if (i in a) count++; return count; }
function ownText(a: number[]): string { let text = ""; for (let i = 0; i < a.length; i++) text += a[i] + ","; return text; }
function ownIterated(a: number[]): string { let text = "", bits = 0; for (const value of a) { text += value + ","; bits = (bits << 1) ^ (value * 4); } return text + bits; }
function ownTimesTwo(a: number[], k: number): number { return a[k] * 2; }
function ownReturned(a: number[], k: number): number { return a[k]; }
function ownOrDefault(a: number[], k: number): number { return a[k] ?? -7; }
function ownTakenApart(a: number[]): string { const [p, q, r = -3, s = -4, t = -5] = a; return p + " " + q + " " + r + " " + s + " " + t; }
function describeOwn(a: number[]): string {
  let single = "";
  for (let k = -1; k <= a.length; k++) single += ownTimesTwo(a, k) + "/" + ownReturned(a, k) + "/" + ownOrDefault(a, k) + " ";
  return a.length + " | " + ownSum(a) + " " + ownXor(a) + " " + ownOrder(a) + " " + ownPastBothEnds(a) + " " + ownCountLess(a) + " " + ownCountNotLess(a) + " " + ownCountAbsent(a) + " " + ownCountPresent(a) + " | " + ownText(a) + " | " + ownIterated(a) + " | " + single + "| " + ownTakenApart(a);
}
const ownFull: number[] = [0.5, 1.5, 2.5, 3.5];
console.log("own, full: " + describeOwn(ownFull));
const ownDeleted: number[] = [0.5, 1.5, 2.5, 3.5];
delete ownDeleted[1];
console.log("own, deleted: " + describeOwn(ownDeleted));
console.log("own, left out: " + describeOwn([0.5, , 2.5, 3.5] as number[]));
const ownLengthened: number[] = [0.5, 1.5];
ownLengthened.length = 4;
console.log("own, lengthened: " + describeOwn(ownLengthened));
const ownPartly = new Array<number>(4);
ownPartly[0] = 0.5;
ownPartly[3] = 3.5;
console.log("own, partly stored: " + describeOwn(ownPartly));
const ownStoredFar: number[] = [0.5];
ownStoredFar[3] = 3.5;
console.log("own, stored past the end: " + describeOwn(ownStoredFar));
const ownWhole: number[] = [1, 2, 3, 4];
delete ownWhole[2];
console.log("own, whole numbers, deleted: " + describeOwn(ownWhole));
console.log("own, empty: " + describeOwn([]));
ownDeleted[1] = 1.5;
console.log("own, filled again: " + describeOwn(ownDeleted));
