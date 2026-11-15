// Two deeds on a list, one after the other, and then a look at all of it: its length, its elements and holes, its other members, whether it is
// closed. Every deed that changes a list or puts another in its place comes first, every deed comes second, on every kind of list.
import type { Cell } from "./cells";

export const makers = {
  integers: `[1, 2, 3]`,
  fractions: `[1.5, 2, 3]`,
  texts: `["a", "b", "c"]`,
  mixed: `[1, "b", { c: 3 }]`,
  unsorted: `[3, 10, 2]`,
  holes: `[1, , 3]`,
  empty: `[]`,
  one: `[2]`,
  "by length": `new Array(3)`,
  "from a length": `Array.from({ length: 3 }, (_, i) => i)`,
  "out of a set": `[...new Set([1, 2, 2, 3])]`,
  "out of a text": `"abc".split("")`,
  frozen: `Object.freeze([1, 2, 3])`,
  "of a class below": `new (class extends Array {})(1, 2, 3)`,
  handed: `tag([1, 2, 3])`,
  nested: `[[1], [2, [3]], 4]`,
} as const;

// They change the list, or put another list in its place.
const changes: Record<string, string> = {
  push: `log(text(s.push(4)));`,
  "push two": `log(text(s.push(4, "five")));`,
  pop: `log(text(s.pop()));`,
  shift: `log(text(s.shift()));`,
  unshift: `log(text(s.unshift(0)));`,
  "splice out": `log(text(s.splice(1, 1)));`,
  "splice in": `log(text(s.splice(1, 0, 9)));`,
  "splice all": `log(text(s.splice(0)));`,
  shorter: `s.length = 1;`,
  longer: `s.length = 5;`,
  emptied: `s.length = 0;`,
  "store at the end": `s[s.length] = 6;`,
  "store beyond": `s[5] = 6;`,
  "store a text": `s[1] = "x";`,
  "store a fraction": `s[0] = 0.5;`,
  "store undefined": `s[1] = undefined;`,
  delete: `log(delete s[1]);`,
  reverse: `log(s.reverse() === s);`,
  sort: `s.sort();`,
  "sort by a function": `s.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));`,
  fill: `s.fill(0);`,
  "fill from 1": `s.fill(7, 1);`,
  copyWithin: `s.copyWithin(0, 1);`,
  "a named member": `s.name = "n";`,
  "a negative index": `s[-1] = "neg";`,
  "an index as a text": `s["1"] = "one";`,
  "a getter at 1": `Object.defineProperty(s, 1, { get() { log("got"); return "G"; }, configurable: true, enumerable: true });`,
  freeze: `Object.freeze(s);`,
  seal: `Object.seal(s);`,
  "no more members": `Object.preventExtensions(s);`,
  "a fixed length": `Object.defineProperty(s, "length", { writable: false });`,
  map: `s = s.map(x => x);`,
  "map to texts": `s = s.map(x => x + "!");`,
  "map to indexes": `s = s.map((x, i) => i);`,
  filter: `s = s.filter((x, i) => i !== 1);`,
  slice: `s = s.slice(1);`,
  "slice from the end": `s = s.slice(-2);`,
  concat: `s = s.concat([9]);`,
  "concat of two kinds": `s = s.concat(9, [[8]]);`,
  spread: `s = [...s];`,
  "spread twice": `s = [...s, ...s];`,
  "spread behind 0": `s = [0, ...s];`,
  flat: `s = s.flat();`,
  flatMap: `s = s.flatMap(x => [x, x]);`,
  toSorted: `s = s.toSorted();`,
  toReversed: `s = s.toReversed();`,
  toSpliced: `s = s.toSpliced(1, 1);`,
  with: `s = s.with(0, 9);`,
  "Array.from": `s = Array.from(s);`,
  "Array.from with a function": `s = Array.from(s, x => x);`,
  "through a set": `s = [...new Set(s)];`,
  "Object.values": `s = Object.values(s);`,
  "through JSON": `s = JSON.parse(JSON.stringify(s));`,
  rest: `[, ...s] = s;`,
  "slice by call": `s = Array.prototype.slice.call(s);`,
  "Array of its elements": `s = Array(...s);`,
  "Array.of": `s = Array.of(...s);`,
  "forEach that pushes": `s.forEach(x => { if (s.length < 6) s.push(x); });`,
  "forEach that pops": `s.forEach(x => { log(text(x)); s.pop(); });`,
  "map that shortens": `log(text(s.map(x => { s.length = 1; return x; })));`,
  "for of that pushes": `for (const x of s) { log(text(x)); if (s.length < 6) s.push("more"); }`,
  "for of that shifts": `for (const x of s) { log(text(x)); s.shift(); }`,
  "filter that stores": `log(text(s.filter((x, i) => { s[i + 1] = "w"; return true; })));`,
  "find that deletes": `s.find((x, i) => { delete s[i + 1]; log(text(x)); return false; });`,
  "reduce that pops": `log(text(s.reduce((sum, x) => { s.pop(); return sum + x; }, "")));`,
};

// They only read.
const reads: Record<string, string> = {
  "at -1": `log(text(s.at(-1)));`,
  "at 5": `log(text(s.at(5)));`,
  "element 1": `log(text(s[1]));`,
  "the last": `log(text(s[s.length - 1]));`,
  "element 7": `log(text(s[7]));`,
  indexOf: `log(s.indexOf(2));`,
  lastIndexOf: `log(s.lastIndexOf(3));`,
  "includes undefined": `log(s.includes(undefined));`,
  "includes 2": `log(s.includes(2));`,
  join: `log(text(s.join()));`,
  "join by a dash": `log(text(s.join("-")));`,
  String: `log(text(String(s)));`,
  template: "log(text(`${s}`));",
  "JSON.stringify": `log(JSON.stringify(s));`,
  sum: `log(text(s.reduce((sum, x) => sum + x, 0)));`,
  "reduce without a start": `log(text(s.reduce((sum, x) => sum + x)));`,
  reduceRight: `log(text(s.reduceRight((sum, x) => sum + x, "")));`,
  "find undefined": `log(text(s.find(x => x === undefined)) + " " + s.findIndex(x => x === undefined));`,
  findLast: `log(text(s.findLast(x => x !== 3)) + " " + s.findLastIndex(x => x !== 3));`,
  some: `log(s.some(x => x === 2));`,
  every: `log(s.every(x => x !== undefined));`,
  forEach: `s.forEach((x, i) => log(i + "=" + text(x)));`,
  "for of": `for (const x of s) log(text(x));`,
  "for in": `for (const k in s) log(k);`,
  "for by index": `for (let i = 0; i < s.length; i++) log(text(s[i]));`,
  entries: `for (const [i, x] of s.entries()) log(i + "=" + text(x));`,
  keys: `log(text([...s.keys()]));`,
  "Object.keys": `log(text(Object.keys(s)));`,
  "Object.entries": `log(text(Object.entries(s)));`,
  length: `log(s.length);`,
  "taken apart": `{ const [a, , b = 5, ...rest] = s; log(text(a) + " " + text(b) + " " + text(rest)); }`,
  "1 in it": `log(1 in s);`,
  "Math.max": `log(Math.max(...s));`,
  "as arguments": `log(((...all) => all.length + text(all))(...s));`,
  apply: `log((function () { return arguments.length + text(arguments[1]); }).apply(null, s));`,
};

export const helpers = `const tag = v => v;
function text(v) { return typeof v === "function" ? "function" : Array.isArray(v) ? "[" + Array.from(v, (x, i) => (i in v ? text(x) : "_")).join() + "]" : typeof v === "object" && v !== null ? "{" + Object.keys(v).map(k => k + ":" + text(v[k])).join() + "}" : typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v); }
function look(s) {
  log("| " + text(s) + " " + s.length);
  const others = Reflect.ownKeys(s).filter(k => k !== "length" && String(k >>> 0) !== k);
  if (others.length) log("others " + others.map(String).join());
  if (!Object.isExtensible(s)) log(Object.isFrozen(s) ? "frozen" : Object.isSealed(s) ? "sealed" : "closed");
  if (s.constructor !== Array) log("of a class below");
}
`;
export const call = `try { run(); } catch (e) { log("threw " + e.name); }`;

export function cells(maker: keyof typeof makers): Cell[] {
  const all: Cell[] = [];
  const letter = "l" + Object.keys(makers).indexOf(maker) + "p";
  for (const [first, one] of Object.entries(changes))
    for (const [second, two] of Object.entries({ ...changes, ...reads })) {
      const id = letter + (all.length + 1);
      all.push({
        id,
        what: `${maker} | ${first} | ${second}`,
        text: `function ${id}() { let s = ${makers[maker]}; ${one} ${two} look(s); }`,
      });
    }
  return all;
}

// A walk over the list. `BODY` stands where a turn's work is done; `i` is the turn's index and `x` its element.
const walks: Record<string, string> = {
  "by index": `for (let i = 0; i < s.length && i < 9; i++) { const x = s[i]; BODY }`,
  "by index, the length read once": `for (let i = 0, n = s.length; i < n; i++) { const x = s[i]; BODY }`,
  backwards: `for (let i = s.length - 1; i >= 0; i--) { const x = s[i]; BODY }`,
  while: `{ let i = 0; while (i < s.length && i < 9) { const x = s[i]; BODY i++; } }`,
  "for of": `{ let i = 0; for (const x of s) { BODY if (++i > 8) break; } }`,
  "for in": `for (const k in s) { const i = Number(k), x = s[k]; BODY }`,
  entries: `for (const [i, x] of s.entries()) { BODY if (i > 8) break; }`,
  forEach: `s.forEach((x, i) => { BODY });`,
  map: `log(text(s.map((x, i) => { BODY return x; })));`,
  reduce: `log(text(s.reduce((sum, x, i) => { BODY return sum + 1; }, 0)));`,
};

// Who does the deed in the second turn: the walk itself, the same under a second name, or a function that is handed the list.
const doers = ["here", "under a second name", "in a function"] as const;

/** A walk over a list, and in its second turn one deed that changes the list. Each turn tells what it sees before and behind. */
export function walksOf(maker: keyof typeof makers): Cell[] {
  const all: Cell[] = [];
  const letter = "w" + Object.keys(makers).indexOf(maker) + "n";
  for (const [walk, loop] of Object.entries(walks))
    for (const [change, deed] of Object.entries(changes))
      for (const doer of doers) {
        // A deed that puts another list in the place of this one is the walk's own.
        if (doer !== "here" && /(^|[ ;{])(s = |\[, \.\.\.s\] = )/.test(deed)) continue;
        const id = letter + (all.length + 1);
        const done =
          doer === "here" ? deed : doer === "under a second name" ? deed.replace(/\bs\b/g, "t") : `change(s);`;
        const body = `log(i + ":" + text(x)); if (i === 1 && !did) { did = true; ${done} } log(text(s[i]) + "/" + s.length);`;
        all.push({
          id,
          what: `${maker} | ${walk} | ${change} | ${doer}`,
          text:
            `function ${id}() { let s = ${makers[maker]}, did = false; ` +
            (doer === "under a second name" ? `const t = s; ` : "") +
            (doer === "in a function" ? `const change = s => { ${deed} }; ` : "") +
            `${loop.replace("BODY", body)} look(s); }`,
        });
      }
  return all;
}
