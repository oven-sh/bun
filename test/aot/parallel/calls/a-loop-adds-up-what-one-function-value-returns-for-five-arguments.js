// A loop calls one function value, with more arguments than x86-64 (five) or ARM64 (ten) has registers for, and adds up what comes back.
// The callee is found once in front of the loop, an entry that reads its rest list by key sets up no frame, and a key that is never a number is not tested for one.
// Flags: --aot-heat=everything-is-hot
// IR-UNTIL Select
// IR= 1 totalOfFive ResolveCallTarget
// IR= 1 totalOfTen ResolveCallTarget
// ENTRY-SIZE< byIndex 400 150
// ENTRY-SIZE< lastOf 120 40
// ENTRY-SIZE< byBoolean 120 24
function byIndex(i, ...rest) { return rest[i]; }
function byBoolean(a, ...rest) { const k = a === 1; return rest[k] === undefined ? 1 : 0; }
function byNothing(a, ...rest) { return (rest[null] === undefined ? 1 : 0) + (rest[undefined] === undefined ? 2 : 0); }
function lastOf(...rest) { return rest[rest.length - 1]; }
function sumOfTail(a, ...rest) { let t = a; for (let i = 0; i < rest.length; i++) t += rest[i]; return t; }
function threeNamed(a, b, c, ...rest) { return String(a) + b + c + rest.length; }
function withDefault(a, b = 7, ...rest) { return a + b + rest.length; }
function ofArguments(a, b) { return (a === undefined ? 100 : a) + (b === undefined ? 1000 : b) + arguments.length + (arguments[4] ?? 0.5); }
function twoNamed(a, b) { return a * 10 + b; }
function sevenNamed(a, b, c, d, e, f, g) { return a + e + (f === undefined ? 0.25 : f) + (g === undefined ? 0.125 : g); }
function countsItsCalls(a, ...rest) { countsItsCalls.calls = (countsItsCalls.calls | 0) + 1; return rest[a] + countsItsCalls.calls; }
function renamesItself(a, ...rest) { if (a === 2) Object.defineProperty(renamesItself, "name", { value: "renamed" + rest.length }); return rest.length; }
function throwsAtThree(a, ...rest) { if (a === 3) throw new RangeError("three of " + rest.length); return rest[0]; }
function fraction(a, ...rest) { return rest[a] / 4; }
function notANumber(a, ...rest) { return a === 2 ? NaN : rest[a]; }
function minusZero() { return -0; }
function text(a, ...rest) { return a === 2 ? "x" : rest[a]; }
function large(a, ...rest) { return rest[a] * 1e9; }
function Made(a, ...rest) { this.a = a; this.n = rest.length; this.isNew = new.target === Made; }
class Kept { constructor(a, b, ...rest) { this.text = String(a) + b + rest.length; } }
class Derived extends Kept { constructor(...all) { super(...all); this.count = all.length; } }
const table = {
  byIndex, byBoolean, byNothing, lastOf, sumOfTail, threeNamed, withDefault, ofArguments, twoNamed, sevenNamed, countsItsCalls, renamesItself, throwsAtThree,
  fraction, notANumber, minusZero, text, large, Made, Kept,
  bound: byIndex.bind(null, 1), boundToMany: sumOfTail.bind(null, 1, 2, 3, 4, 5, 6), max: Math.max, of: Array.of, hypot: Math.hypot,
  proxy: new Proxy(lastOf, {}), number: 5, nothing: undefined, none: null, object: {},
};
const pick = name => table[JSON.parse(JSON.stringify(name))];
function totalOfFive(f, turns) { let t = 0; for (let i = 0; i < turns; i++) t += f(i & 3, 1, 2, 3, 4); return t; }
function totalOfTen(f, turns) { let t = 0; for (let i = 0; i < turns; i++) t += f(i & 3, 1, 2, 3, 4, 5, 6, 7, 8, 9); return t; }
function takenAway(f, turns) { let t = 0.5; for (let i = 0; i < turns; i++) t = f(i & 3, 1, 2, 3, 4) - t; return t; }
function twoSums(f, g, turns) { let s = 0.5, t = -0; for (let i = 0; i < turns; i++) { s += f(i & 3, 1, 2, 3, 4); t += g(i & 3, 1, 2, 3, 4) + s; } return s + " " + t; }
function caughtInTheLoop(f, turns) { let t = 0.25, caught = 0; for (let i = 0; i < turns; i++) { try { t += f(i & 3, 1, 2, 3, 4); } catch (e) { caught += t; } } return t + " " + caught; }
function caughtAroundTheLoop(f, turns) { let t = 0.25; try { for (let i = 0; i < turns; i++) t += f(i & 3, 1, 2, 3, 4); } catch (e) { return "caught at " + t; } return t; }
function calledAgainBehindTheSum(f, g, turns) { let t = 0.5; for (let i = 0; i < turns; i++) { t += f(i & 3, 1, 2, 3, 4); g(i & 3, 1, 2, 3, 4); } return t; }
function handedToTheCall(f, turns) { let t = 0.5; for (let i = 0; i < turns; i++) t = t / 2 + f(i & 1, t, t + 1, 3, 4); return t; }
function calledInSomeTurns(f, turns) { let t = 0.5; for (let i = 0; i < turns; i++) { if (i & 1) t += f(i & 3, 1, 2, 3, 4); else t += 0.25; } return t; }
function lengthsOfUrl(request, turns) { let t = 0; for (let i = 0; i < turns; i++) t += request.url.length; return t; }
const show = (label, run) => { let r; try { r = run(); } catch (e) { r = "threw " + e.constructor.name + ": " + e.message; } console.log(label, Object.is(r, -0) ? "-0" : String(r)); };
for (const name of Object.keys(table)) {
  for (const turns of [0, 1, 7]) {
    show(name + " five " + turns, () => totalOfFive(pick(name), turns));
    show(name + " ten " + turns, () => totalOfTen(pick(name), turns));
  }
  show(name + " taken away", () => takenAway(pick(name), 6));
  show(name + " caught in the loop", () => caughtInTheLoop(pick(name), 9));
  show(name + " caught around the loop", () => caughtAroundTheLoop(pick(name), 9));
  show(name + " called again behind the sum", () => calledAgainBehindTheSum(pick(name), pick("countsItsCalls"), 6));
  show(name + " handed to the call", () => handedToTheCall(pick(name), 6));
  show(name + " called in some turns", () => calledInSomeTurns(pick(name), 7));
}
show("two sums", () => twoSums(pick("fraction"), pick("large"), 11));
// The getter calls only while its cache is empty: the sum of this loop waits past no call.
show("lengths of a url", () => lengthsOfUrl(new Request("http://example.com/a/b?c=d"), 1000));
show("names", () => renamesItself.name + " " + countsItsCalls.calls);
// Fewer arguments than the entry names: each way into it hands over undefined for the rest.
const lists = [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5], [0, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
for (const name of ["byIndex", "byBoolean", "byNothing", "lastOf", "sumOfTail", "threeNamed", "withDefault", "ofArguments", "sevenNamed"]) {
  const f = pick(name);
  show(name + " none", () => f());
  show(name + " one", () => f(0));
  show(name + " two", () => f(0, "b"));
  show(name + " three", () => f(1, "b", "c"));
  for (const list of lists) {
    show(name + " spread " + list.length, () => f(...list));
    show(name + " apply " + list.length, () => Reflect.apply(f, null, list));
    show(name + " call " + list.length, () => f.call(null, ...list));
    show(name + " bound " + list.length, () => f.bind(null, ...list)());
  }
}
for (const list of lists) {
  show("Made " + list.length, () => JSON.stringify(new (pick("Made"))(...list)));
  show("Kept " + list.length, () => JSON.stringify(new (pick("Kept"))(...list)));
  show("Derived " + list.length, () => JSON.stringify(new Derived(...list)));
  show("constructed " + list.length, () => JSON.stringify(Reflect.construct(pick("Made"), list, pick("Kept"))));
}
