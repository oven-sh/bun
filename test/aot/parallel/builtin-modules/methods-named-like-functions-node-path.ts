// join, normalize, format, parse and resolve are functions of node:path and methods of arrays, strings, formatters, JSON and Promise. A call by such a name goes by what the receiver is, whatever else in the
// program is stored under the name: where the declared receiver is an array, `list.join(",")` is the array's join; and where the value is not what was declared, the call still reaches what the value holds.
import path from "node:path";

declare const console: { log(...values: unknown[]): void };
const seen = new Function("value", "return value" + String(process.argv.length).slice(9)) as <V>(value: V) => V;

function show(run: () => unknown): string {
  try {
    const value = run();
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  } catch (error) {
    return "threw " + (error instanceof Error ? error.name : String(error));
  }
}

function joinWith(list: string[], separator: string): string { return list.join(separator); }
function joinPlain(list: string[]): string { return list.join(); }
function joinNumbers(list: number[]): string { return list.join("-"); }
function joinMixed(list: (string | number | null | undefined)[]): string { return list.join("|"); }
function joinBytes(list: Uint8Array): string { return list.join("."); }
function joinAnything(list: { join(separator: string): string }): string { return list.join("/"); }
function normalized(text: string): string { return text.normalize(); }
function normalizedAs(text: string, form: string): string { return text.normalize(form); }
function formatted(format: Intl.NumberFormat, value: number): string { return format.format(value); }
function lengthOfJoined(list: string[]): number { let total = 0; for (let i = 0; i < 3; i++) total += list.join(",").length; return total; }

class Loud extends Array<string> { join(separator?: string): string { return "LOUD" + super.join(separator).toUpperCase(); } }
const withOwnJoin: string[] = ["a", "b"];
(withOwnJoin as unknown as { join: unknown }).join = function (this: string[], separator: string) { return "own(" + this.length + separator + ")"; };
const holey: string[] = ["a", "b", "c"];
delete holey[1];
const nested = [["a", "b"], ["c"]] as unknown as string[];
const cyclic: unknown[] = ["a"];
cyclic.push(cyclic);

const lists: [string, unknown][] = [
  ["an array", ["x", "y", "z"]], ["one element", ["x"]], ["no element", []], ["long texts", ["alpha".repeat(20), "beta".repeat(20)]], ["two-byte texts", ["α", "b", "γδ"]],
  ["a hole", holey], ["nested", nested], ["itself inside", cyclic], ["numbers", [1, 2.5, -0, NaN]], ["nothing among them", ["a", null, undefined, "b"]], ["objects", [{}, { toString() { return "T"; } }]],
  ["a subclass", Loud.from(["p", "q"])], ["its own join", withOwnJoin], ["path", path], ["path.posix", path.posix], ["path.win32", path.win32], ["an object", { join(separator: string) { return "object" + separator; } }],
  ["an object without", {}], ["bytes", new Uint8Array([1, 2, 3])], ["a text", "text"], ["null", null], ["undefined", undefined], ["arguments", (function (..._: string[]) { return arguments; })("m", "n")],
];

for (let turn = 0; turn < 3; turn++) {
  for (const [name, value] of lists) {
    const given = seen(value);
    console.log(turn, name,
      show(() => joinWith(given as string[], ",")), show(() => joinWith(given as string[], "")), show(() => joinWith(given as string[], "—")), show(() => joinPlain(given as string[])),
      show(() => joinNumbers(given as number[])), show(() => joinMixed(given as string[])), show(() => joinBytes(given as Uint8Array)), show(() => joinAnything(given as string[])), show(() => lengthOfJoined(given as string[])));
  }
  for (const [name, value] of [["a text", "a/../bÅ"], ["path", path], ["path.posix", path.posix], ["an object", { normalize(form?: string) { return "object " + form; } }], ["a number", 5]] as [string, unknown][]) {
    const given = seen(value);
    console.log(turn, name, show(() => normalized(given as string)), show(() => normalizedAs(given as string, "NFD").length), show(() => normalizedAs(given as string, "a//b/../c")), show(() => normalizedAs(given as string, "nothing")));
  }
  for (const [name, value] of [["a formatter", new Intl.NumberFormat("en")], ["path", path], ["an object", { format(value: number) { return "object " + value; } }]] as [string, unknown][]) {
    const given = seen(value);
    console.log(turn, name, show(() => formatted(given as Intl.NumberFormat, 1234.5)), show(() => formatted(given as Intl.NumberFormat, seen({ dir: "/d", base: "b.txt" }) as unknown as number)));
  }
}

const { join, normalize, resolve, basename } = path;
const joinOfArrays = Array.prototype.join;
console.log(path.join("a", "..", "b", "c"), path.posix.join("a", "", "b"), join("x", "y"), join(), join.call(null, "p", "q"), join.apply(undefined, ["r", "s"]), normalize("a//b/./c/.."), basename(resolve("/r", "s.txt")));
console.log([["a", "b"], ["c", "..", "d"]].map(parts => path.join(...parts)).join(","), ["a", "b"].map(part => path.join(part, "z")).join(path.sep), joinOfArrays.call(["k", "l"], "+"), joinOfArrays.call({ length: 2, 0: "m", 1: "n" }, "+"));
console.log(show(() => (seen(join) as unknown as (this: string[], separator: string) => string).call(["a", "b"], "c")), show(() => (seen(joinOfArrays) as (...parts: string[]) => string)("a", "b")), show(() => path.join(seen(5) as unknown as string)));
console.log(JSON.parse("[1,2]").join("&"), show(() => path.parse("/a/b.c").base), show(() => (seen(path) as unknown as typeof JSON).parse("/a/b.c")), show(() => (seen(JSON) as unknown as typeof path).parse("[3]")));
Promise.resolve(["u", "v"]).then(list => console.log(list.join("~"), show(() => (seen(path) as unknown as typeof Promise).resolve("/w")), show(() => typeof (seen(Promise) as unknown as typeof path).resolve("/w"))));
