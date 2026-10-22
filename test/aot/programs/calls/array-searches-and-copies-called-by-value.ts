// indexOf, includes and slice of arrays, reached by value: the receiver is `any` and the method comes out of a variable, so the call finds the built-in only at run time. What is searched for: objects, strings equal by identity, by text alone, of the same length and another text, atoms, ropes, 16-bit text, numbers in both forms, undefined beside holes, null, booleans, BigInts, NaN. An element whose text is compared is followed by further elements, so the search goes on behind a comparison
const opaque = <T>(value: T): T => Reflect.get({ value }, ["val", "ue"].join("")) as T;
const lines: string[] = [];
const indexOf = opaque(Array.prototype.indexOf) as (this: unknown, ...list: unknown[]) => number;
const includes = opaque(Array.prototype.includes) as (this: unknown, ...list: unknown[]) => boolean;
const slice = opaque(Array.prototype.slice) as (this: unknown, ...list: unknown[]) => unknown[];
function search(list: any, searched: unknown): string { return list.indexOf(searched) + "," + list.includes(searched) + "," + indexOf.call(list, searched) + "," + includes.call(list, searched); }
const withoutBigInts = (key: string, value: unknown): unknown => (typeof value === "bigint" ? value + "n" : value);
function copies(list: any): string { return JSON.stringify([list.slice(), list.slice(1), list.slice(1, -1), list.slice(-2), list.slice(5, 2), slice.call(list), slice.call(list, 2), slice.call(list, 0, 1)], withoutBigInts); }

const made = (text: string): string => (text + "!").slice(0, -1);
const rope = (text: string): string => opaque(text.slice(0, 2)) + opaque(text.slice(2));
const a = { id: 1 }, b = { id: 2 }, c = { id: 3 };
const lists: Record<string, unknown[]> = {
  objects: [a, b, c, a],
  texts: ["alpha", "beta", "gamma", "delta", "epsilon", "gamma"],
  "made texts": [made("alpha"), made("beta!"), made("gamma"), made("delta"), made("gamme"), made("gamma")],
  "same length": ["aaaaa", "aaaab", "aaaba", "aabaa", "abaaa", "baaaa", "aaaaa"].map(made),
  "long texts": ["x".repeat(40) + "1", "x".repeat(40) + "2", "x".repeat(40) + "3"].map(made),
  "wide texts": ["ЖЗ", "ab", "ЖИ", made("ЖИ")],
  ropes: [rope("alphabet"), rope("betatron"), rope("gammaray")],
  mixed: [a, "alpha", 1, null, made("beta"), undefined, true, 2.5, b, made("alpha"), 10n, NaN, -0],
  integers: [5, 4, 3, 2, 1, 0, -1],
  fractions: [0.5, 1.5, 2, NaN, -0],
  holes: [a, , "alpha", , undefined, b],
  empty: [],
  one: ["only"],
};
const searchedFor: unknown[] = [a, b, c, { id: 1 }, "alpha", made("alpha"), rope("alpha"), "gamma", made("gamma"), made("gamme"), "aaaaa", made("baaaa"), made("aabaa"), made("zzzzz"),
  "x".repeat(40) + "3", made("x".repeat(40) + "2"), "ЖИ", made("ЖЗ"), "ab", rope("gammaray"), made("betatron"), "", "only", made("only"),
  1, 1.0, 2, 2.5, 0, -0, NaN, 5, -1, undefined, null, true, false, 10n, 10n ** 20n, Symbol.iterator];
for (let round = 0; round < 3; round++) {
  for (const title in lists) {
    const list = opaque(lists[title]);
    let text = title + ":";
    for (const searched of searchedFor) text += " " + search(list, opaque(searched));
    if (round === 0) lines.push(text, title + " " + copies(list).replace(/null/g, "_"));
  }
}
// What is no plain array goes the long way and answers the same.
const frozen = Object.freeze(["alpha", made("beta")]);
const withProperty: any = ["alpha", made("beta")]; withProperty.extra = 1;
class Own extends Array<unknown> {}
const own = Own.from(["alpha", made("beta")]);
const arrayLike = { length: 2, 0: "alpha", 1: made("beta") };
for (const list of [frozen, withProperty, own]) lines.push(search(opaque(list), made("beta")) + " " + copies(opaque(list)) + " " + (opaque(list) as any).slice().constructor.name);
lines.push(indexOf.call(arrayLike, made("beta")) + " " + includes.call(arrayLike, "alpha") + " " + JSON.stringify(slice.call(arrayLike)) + " " + indexOf.call("text", "x") + " " + JSON.stringify(slice.call("text", 1)));
// The copy is a copy.
const original = [a, b, c];
const copy = (opaque(original) as any).slice();
copy[0] = c; copy.push(a);
lines.push(original.length + " " + (original[0] === a) + " " + copy.length + " " + (copy[0] === c));
console.log(lines.join("\n"));
