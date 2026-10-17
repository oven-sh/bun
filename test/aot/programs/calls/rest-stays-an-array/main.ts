// Rest parameters and `arguments` that must still be real arrays or objects because they escape, are modified or are compared.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
const show = (name: string, ...given: any[]) => { let r: any; try { r = m[name](...given); } catch (e) { r = "threw " + e; } console.log(name, given.length, String(r)); };
const lists: any[][] = [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [undefined], [null, undefined], [{ toString() { return "o"; } }, "s"]];
for (const name of ["storesElement", "storesLength", "pushes", "aliased", "escapesThenReads", "readsThenEscapes", "escapesInLoop", "outOfBounds", "byName", "keyWithEffects", "inOperator", "forOf", "forIn",
  "spreadIntoArray", "destructured", "withDefault", "appliesThenReads", "inCatch", "typeOfIt", "toStringOfIt", "json", "compared", "capturedAndStored", "sloppyLength",
  "argumentsByName", "argumentsOutOfBounds", "argumentsStored", "argumentsLengthStored", "argumentsCopied", "argumentsSliced", "argumentsForwarded"]) {
  for (const list of lists) show(name, ...list);
}
for (const flag of [true, false]) for (const list of lists) { show("escapesOnOnePath", flag, ...list); show("escapesOnOnePathThenReads", flag, ...list); }
for (const key of [0, 1, 2, -1, 0.5, "0", "1", "length", "x", NaN, 4294967296, null, undefined, true, 1n]) show("byKey", key, "a", "b");
const join = function (this: any) { return Array.prototype.join.call(arguments, "+"); };
for (const list of lists) { show("appliesInLoop", join, ...list); show("spreadsThenReads", join, ...list); show("throwsBetween", () => { throw 1; }, ...list); show("throwsBetween", () => 1, ...list); }
show("recursive", 6, "z"); show("recursive", 0);
// Identity, and the returned value is an array like any other.
{ const a = m.returned(1, 2); a.push(3); console.log(a.length, Array.isArray(a), m.returned() !== m.returned(), m.captured(1)() === m.captured(1)()); const c = m.captured(5, 6); console.log(c() === c(), c()[1]); }
console.log(m.kept.length, m.kept.every((k: any) => Array.isArray(k)));
{ const a = m.argumentsEscape(1, 2); console.log(a.length, a[1], Object.prototype.toString.call(a)); }
// Every way in.
console.log(m.returned.call(null, 1, 2).join(), m.returned.apply(null, [1, 2, 3]).join(), (Reflect.apply(m.returned, null, [4]) as any).join(), m.returned.bind(null, 1)(2).join(), [1, 2].map(m.returned).join("|"));
console.log(m.sloppyLength.call(null), m.sloppyLength.apply(null, [1, 2, 3, 4, 5, 6]), [7].map(m.sloppyLength).join(), m.sloppyLength.bind(null, 1, 2)(3), new m.Constructed(1, 2).n, new m.Constructed().first, (Reflect.construct(m.Constructed, [3]) as any).first);
console.log([...m.generator(1, 2)].map(String).join("|"));
m.asynchronous(1, 2).then((r: any) => console.log("async", r));
export {};
