// `list.sort()` without a comparator orders the elements by their strings, code unit by code unit, puts undefined behind
// them and holes last, and keeps equal elements in their order. A short list of strings may be sorted by a shortcut. Each
// scene picks the strings (Latin-1 or not, surrogate pairs, prefixes of each other, equal ones, joined or sliced at run
// time), what else the list holds (numbers, undefined, holes, objects whose toString is counted or throws, symbols), its
// length (around 64 too) and its state (frozen, an accessor under an index, a subclass, a look-alike, a proxy).
import type { Random } from "./random";

/** Expressions for the elements, spread into the list. */
const groups = [
  '["b", "a", "c"]',
  '["b", "a", "c", "a", "b"]',
  '["a", "aa", "", "a", "ab", "aaa"]',
  '["10", "9", "1", "100", "09"]',
  '["z", "\\u00e9", "e", "\\u00c9", "E"]',
  '["\\uff5e", "\\ud83d\\ude00", "\\ud7ff", "\\ue000", "a"]',
  '["a\\u0000", "a", "a\\u0001", "a "]',
  '[part("b") + part("a"), part("a") + part("b"), "ab", "ba"]',
  '[part("xyzabc").slice(3), part("xyzabc").slice(0, 3), "abc"]',
  '["a", "b", "c", "d"]',
  '["d", "c", "b", "a"]',
  '["same", "same", "same"]',
  "Array.from({ length: LENGTH }, (_, at) => String((at * 7919) % 101))",
  'Array.from({ length: LENGTH }, (_, at) => "k" + ((at * 31) % LENGTH))',
  "Object.keys({ zeta: 1, alpha: 2, 10: 3, 9: 4, mid: 5 })",
];

/** More elements that are no strings. */
const others = [
  "[]",
  "[]",
  "[]",
  "[10, 9, 1]",
  "[undefined]",
  "[undefined, null, undefined]",
  "[, ,]",
  "[true, false, null]",
  "[1.5, -1, -0, NaN, Infinity]",
  "[10n, 9n]",
  '[new String("b"), new String("a"), new String("b")]',
  '[counted("b"), counted("a")]',
  '[{ toString: () => "a" }, { valueOf: () => "z" }]',
  "[thrower]",
  '[Symbol("s")]',
  '[["b", "a"], ["a"]]',
  "[() => 1]",
];

/** Statements that change `list` before it is sorted. */
const states = [
  "",
  "",
  "",
  "",
  "Object.freeze(list);",
  "Object.seal(list);",
  "Object.preventExtensions(list);",
  'Object.defineProperty(list, "length", { writable: false });',
  'Object.defineProperty(list, 0, { get: () => "m", set() {}, configurable: true });',
  'Object.defineProperty(list, 1, { value: "m", writable: false, configurable: true });',
  "delete list[1];",
  'list[list.length + 3] = "far";',
  'list[5000] = "very far";\n    list.length = Math.min(list.length, 8);',
  'list.extra = "kept";',
  "Object.setPrototypeOf(list, Below.prototype);",
  'Object.setPrototypeOf(list, { __proto__: Array.prototype, 1: "inherited" });\n    delete list[1];',
  "list.length = 2;",
];

/** Expressions that sort `list`. */
const sorts = [
  "list.sort()",
  "list.sort()",
  "list.sort(undefined)",
  "list.sort() === list",
  "[...list].sort()",
  "list.slice().sort()",
  "list.toSorted()",
  "Array.prototype.sort.call(list)",
  "Array.prototype.sort.call({ length: list.length, ...list })",
  "Array.prototype.sort.call(new Proxy(list, {}))",
  "Below.from(list).sort()",
  "list.sort().reverse()",
  "list.sort().sort()",
  "list.concat(list).sort()",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const length = random.pick(["0", "1", "2", "7", "63", "64", "65", "70"]);
    const strings = random.pick(groups).replaceAll("LENGTH", length);
    const other = random.pick(others);
    const parts = random.chance(0.8) ? [strings, other] : [other, strings];
    const rounds = random.pick([1, 1, 3, 300]);
    scenes.push(`function scene${scene}() {
  const list = [...${parts[0]}, ...${parts[1] === "[, ,]" ? "[]" : parts[1]}];
  ${other === "[, ,]" ? "list.length += 2;" : ""}
  const prepared = told(() => {
    ${random.pick(states)}
  });
  const answer = told(() => ${random.pick(sorts)});
  const asked = calls.splice(0).join("");
  return [prepared, asked, shown(answer), shown(list)].join(" | ");
}
{
  const answers = new Set();
  for (let round = 0; round < ${rounds}; round++) answers.add(scene${scene}());
  console.log("scene ${scene}", [...answers].join(" || "));
}`);
  }
  return `const part = text => process.argv[9] ?? text;
const calls = [];
const counted = text => ({
  toString() {
    calls.push(text);
    return text;
  },
});
const thrower = {
  toString() {
    throw new RangeError("no string");
  },
};
class Below extends Array {}
function code(text) {
  return Array.from({ length: text.length }, (_, at) => text.charCodeAt(at).toString(16)).join(".");
}
function shown(value) {
  if (value === null || typeof value !== "object" || typeof value.length !== "number") return String(value);
  const parts = [];
  for (let at = 0; at < value.length; at++) {
    if (!(at in value)) parts.push("hole");
    else {
      const item = value[at];
      parts.push(typeof item === "string" ? code(item) : typeof item === "symbol" ? "symbol" : typeof item + ":" + told(() => (Object.is(item, -0) ? "-0" : String(item))));
    }
  }
  calls.length = 0;
  return value.constructor?.name + " " + value.length + " [" + parts.join(",") + "]" + (value.extra ?? "");
}
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
