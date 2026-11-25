import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// Compiled code defines the members of a literal that stand under index keys behind the names, so that the names lie side by side in the allocation and one odd key does not
// make a closed definition of every name behind it. Nobody may be able to tell: every list of keys names the indexes first, in their own order, and the names as written.
// What could tell: a later member under the same key, a spread, a key that is computed, an accessor, the order in which the values are computed, and a literal that is left half way.

const program = `
const lines = [];
const seen = [];
const note = value => (seen.push(value), value);
function show(name, object) {
  const own = Reflect.ownKeys(object).map(key => {
    const found = Object.getOwnPropertyDescriptor(object, key);
    const flags = (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-");
    const held = "value" in found ? (typeof found.value === "function" ? "function " + found.value.name : JSON.stringify(found.value)) : (found.get ? "get" : "") + (found.set ? "set" : "");
    return String(key) + "=" + held + " " + flags;
  });
  const prototype = Object.getPrototypeOf(object);
  lines.push(name + ": " + own.join(", ") + " | " + (prototype === Object.prototype ? "plain" : prototype === null ? "null" : Object.keys(prototype).join()) + " | " + seen.splice(0).join());
}
const v = globalThis.never ? 0 : "v";
const seven = globalThis.never ? 0 : 7;
const name = globalThis.never ? "" : "b";
const other = globalThis.never ? {} : { 7: "spread seven", b: "spread b", z: "spread z", 1: "spread one" };

show("constants", { a: 1, 7: 2, b: 3, 0: 4, c: 5 });
show("values", { a: v, 7: v, b: v, 0: v, c: v });
show("first", { 7: v, a: v, b: v });
show("last", { a: v, b: v, 7: v });
show("alone", { 7: v, 3: v, 5: v });
show("written as texts", { a: v, "7": v, b: v, "0": v });
show("in brackets", { a: v, [7]: v, b: v, ["0"]: v, c: v });
show("no indexes", { a: v, "07": v, "1.5": v, "-0": v, "-1": v, "1e3": v, "4294967295": v, "4294967294": v, " 1": v, b: v });
show("the same index twice", { a: v, 7: "first", b: v, 7: "second", c: v });
show("the same index as a number and as a text", { 7: "number", a: v, "7": "text" });
show("the same name twice around an index", { a: "first", 7: v, a: "second", b: v });
show("order of the values", { a: note("a"), 7: note("seven"), b: note("b"), 0: note("zero"), c: note("c") });
show("a computed key that is the index, behind it", { a: v, 7: "written", b: v, [seven]: "computed", c: v });
show("a computed key that is the index, in front of it", { a: v, [seven]: "computed", b: v, 7: "written", c: v });
show("a computed key that is a name", { a: v, 7: v, [name]: "computed", b: "written", c: v });
show("the key is computed behind the value of the index", { 7: note("value"), [note("key")]: note("value of key"), 3: note("three") });
show("a spread behind the index", { a: v, 7: "written", 1: "written", b: "written", ...other, c: v });
show("a spread in front of the index", { a: v, ...other, 7: "written", b: "written", c: v });
show("a spread between two", { 7: "first", ...other, 7: "second" });
show("a spread of a literal", { a: v, ...{ 7: "inner", b: "inner" }, 7: "outer", c: v });
show("a spread of a literal behind", { a: v, 7: "outer", ...{ 7: "inner", b: "inner" }, c: v });
show("a spread that a condition takes", { a: v, 7: "outer", ...(v && { 7: "inner", 3: "inner", b: "inner" }), c: v });
show("a spread that a condition leaves", { a: v, 7: "outer", ...(!v && { 7: "inner", 3: "inner", b: "inner" }), c: v });
show("a spread of one of two", { a: v, 7: "outer", ...(v ? { 7: "yes", 3: "yes" } : { 7: "no", 5: "no" }), 3: "behind", c: v });
show("a spread of the other of two", { a: v, 7: "outer", ...(!v ? { 7: "yes", 3: "yes" } : { 7: "no", 5: "no" }), 3: "behind", c: v });
show("a getter under the index behind it", { a: v, 7: "value", get 7() { return 1; }, b: v });
show("a getter under the index in front of it", { a: v, get 7() { return 1; }, 7: "value", b: v });
show("a getter and a setter around it", { get 7() { return 1; }, a: v, 3: v, set 7(value) {}, b: v });
show("a getter under a name", { a: v, 7: v, get g() { return 1; }, b: v, 3: v });
show("a method under an index", { a: v, 7() { return 1; }, b: v });
show("a function under an index", { a: v, 7: function () {}, 3: () => {}, 5: class {}, b: v });
show("a method that reaches the object above", { __proto__: { inherited: 1 }, 7: v, m() { return super.inherited; }, 3: v, a: v });
show("a prototype is written", { a: v, 7: v, __proto__: { inherited: 1 }, 3: v, b: v });
show("no prototype", { a: v, 7: v, __proto__: null, 3: v, b: v });
show("an own member named __proto__", { a: v, 7: v, ["__proto__"]: v, 3: v, b: v });
show("a prototype with a setter under the index", { __proto__: { set 7(value) { note("the setter ran"); } }, a: v, 7: v });
show("shorthand", { v, 7: v, seven });
show("literals inside", { a: { 1: v, x: v }, 7: { y: v, 2: v }, b: [v] });
function leaves() { try { return { a: note("a"), 7: note("seven"), b: (() => { throw new Error("left"); })(), 3: note("never") }; } catch (error) { return { caught: error.message }; } }
show("left half way", leaves());
function* steps() { return { a: yield "one", 7: yield "two", b: yield "three", 0: yield "four" }; }
const walk = steps(); walk.next(); walk.next("a"); walk.next("seven"); walk.next("b");
show("a generator", walk.next("zero").value);
show("awaited", await (async () => ({ a: await v, 7: await "seven", b: await v, 0: await "zero" }))());
function frozen() { return Object.freeze({ a: v, 7: v, b: v }); }
show("frozen", frozen());
const stored = { a: v, 7: v, b: v }; stored[3] = "later"; stored.c = "later"; delete stored[7]; stored[7] = "again";
show("stored into later", stored);
show("for in", (() => { const found = []; for (const key in { b: v, 7: v, a: v, 0: v }) found.push(key); return { found: found.join() }; })());
show("copied", { ...{ b: v, 7: v, a: v, 0: v } });
show("assigned", Object.assign({}, { b: v, 7: v, a: v, 0: v }));
show("entries", { entries: JSON.stringify(Object.entries({ b: v, 7: v, a: v, 0: v })) });
console.log(lines.join("\\n"));
`;

const typed = `
enum Color { Red, Green = 5, Blue }
enum Mixed { A = 1, B = "b", C = 3 }
const record: Record<string, string> = { a: "x", b: "y", 7: "seven", 9: "nine", c: "z", d: "w" };
const numbers: Record<number, string> = { 3: "three", 1: "one" };
const both: { [key: string]: number; named: number } = { first: 1, 7: 2, named: 3, 0: 4 };
function made(v: string): Record<string, string> { return { a: v, 7: v, b: v, 0: v }; }
console.log(JSON.stringify([Color, Mixed, record, numbers, both, made("v")]));
console.log([Color, Mixed, record, numbers, both, made("v")].map(object => Reflect.ownKeys(object).join()).join(" | "));
record.e = "later"; record[8] = "eight"; delete record.a;
console.log(Reflect.ownKeys(record).join(), record[7], record["9"], record.c);
`;

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

for (const [main, text] of [
  ["literals.mjs", program],
  ["typed.ts", typed],
]) {
  test(main, async () => {
    using dir = tempDir("aot-index-keys", { [main]: text });
    const folder = String(dir);
    const executable = join(folder, "compiled" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", "./" + main, "--outfile", executable], folder);
    expect({
      errors: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({
      errors: [],
      exitCode: 0,
    });
    const [plain, compiled] = await Promise.all([
      run([bunExe(), "run", "./" + main], folder),
      run([executable], folder),
    ]);
    expect(plain.stdout.split("\n").length).toBeGreaterThan(3);
    expect({ stdout: compiled.stdout.split("\n"), exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout.split("\n"),
      exitCode: plain.exitCode,
    });
  });
}
