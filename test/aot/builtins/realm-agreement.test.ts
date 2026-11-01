import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../harness/commands";
import { test } from "../supported";

async function buildExecutable(folder: string) {
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  built(await spawned([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], folder, bunEnv));
  return executable;
}

// From a file: `bun -e` puts the built-in modules on the global object, and a test file's realm holds what its helpers add.
async function runFile(source: string) {
  using dir = tempDir("aot-realm-agreement", { "main.mjs": source + "\n" });
  return await spawned([bunExe(), "run", "main.mjs"], String(dir), bunEnv);
}

const mismatches =
  'import { aotBuiltinMismatches } from "bun:internal-for-testing";\nconsole.log(JSON.stringify(aotBuiltinMismatches()));';

// The flow analysis takes `globalThis.name` for absent where the table lists no such member and no statement stores one. So the table has to list every own name
// that the engine and the host give the global object, also those that appear when another is touched, and nothing but Object.prototype may lie above it.
// It takes `globalThis[Symbol.for(text)]` so too: the engine and the host lay nothing on the global object under a symbol.
const namesOfGlobalObject = [
  'import { aotBuiltinEntries } from "bun:internal-for-testing";',
  'const listed = new Set(aotBuiltinEntries().entries.filter(entry => entry.holder === "GlobalThis").map(entry => entry.name));',
  'listed.add("globalThis");',
  "const atStart = Object.getOwnPropertyNames(globalThis);",
  "for (const name of atStart) {",
  "  try {",
  "    void globalThis[name];",
  "  } catch {}",
  "}",
  "const unlisted = Object.getOwnPropertyNames(globalThis).filter(name => !listed.has(name));",
  "const symbols = Object.getOwnPropertySymbols(globalThis).map(String);",
  "console.log(JSON.stringify({ unlisted, symbols, isBelowObjectPrototype: Object.getPrototypeOf(globalThis) === Object.prototype }));",
].join("\n");

test("the table lists every own name of the global object but ShadowRealm, which a compiled program does not have", async () => {
  expect(JSON.parse((await runFile(namesOfGlobalObject)).stdout)).toEqual({
    unlisted: ["ShadowRealm"],
    symbols: [],
    isBelowObjectPrototype: true,
  });
});

test(
  "the table lists every own name of the global object of an executable",
  () =>
    slot(async () => {
      using dir = tempDir("aot-realm-agreement", { "main.mjs": namesOfGlobalObject + "\n" });
      const folder = String(dir);
      const executable = await buildExecutable(folder);
      const ran = await spawned([executable], folder, bunEnv);
      expect({ names: JSON.parse(ran.stdout), exitCode: ran.exitCode, signal: ran.signal }).toEqual({
        names: { unlisted: [], symbols: [], isBelowObjectPrototype: true },
        exitCode: 0,
        signal: null,
      });
    }),
  600_000,
);

// The flow analysis takes `Constructor.name` for absent where the table lists no such member. So the table has to list every own key of a constructor that it says it lists whole.
const keysOfConstructors = [
  'import { aotBuiltinEntries } from "bun:internal-for-testing";',
  "const { entries } = aotBuiltinEntries();",
  "const byToken = new Map(entries.map(entry => [entry.token, entry]));",
  "const membersOf = Map.groupBy(entries, entry => entry.holder);",
  'const find = entry => (entry.token === "GlobalThis" ? globalThis : entry.holder && find(byToken.get(entry.holder))?.[entry.name]);',
  'const textOf = key => (typeof key === "symbol" ? "@@" + key.description.slice(7) : key);',
  "const unlisted = [];",
  "let compared = 0;",
  "for (const entry of entries) {",
  '  if (entry.kind !== "Constructor" || entry.sameObjectAs || !entry.flags.includes("ListsAllMembers")) continue;',
  "  const constructor = find(entry);",
  '  if (typeof constructor !== "function") continue;',
  "  compared++;",
  '  const listed = new Set(["length", "name"]);',
  '  for (const member of membersOf.get(entry.token) ?? []) listed.add((member.isSymbolName ? "@@" : "") + member.name);',
  '  for (const key of Reflect.ownKeys(constructor)) if (!listed.has(textOf(key))) unlisted.push(entry.path + " " + textOf(key));',
  "}",
  "console.log(JSON.stringify({ unlisted, comparesMany: compared > 100 }));",
].join("\n");

test("the table lists every own key of the constructors that a program can name", async () => {
  expect(JSON.parse((await runFile(keysOfConstructors)).stdout)).toEqual({ unlisted: [], comparesMany: true });
});

// The flow analysis takes what `new` makes of a function for an object of the program's where the table says only what a call does. So the table has to say what `new` does of every function that
// can be constructed: what the function answers may take the place of the new object.
const functionsThatCanBeConstructed = [
  'import { aotBuiltinEntries } from "bun:internal-for-testing";',
  "const { entries } = aotBuiltinEntries();",
  "const byToken = new Map(entries.map(entry => [entry.token, entry]));",
  "const load = path => {",
  "  try {",
  "    return require(path);",
  "  } catch {}",
  "};",
  "const find = entry => {",
  '  if (entry.token === "GlobalThis") return globalThis;',
  "  if (/^(node|bun):[^.]*$/.test(entry.path)) return load(entry.path);",
  "  const holder = entry.holder && find(byToken.get(entry.holder));",
  '  if ((typeof holder !== "object" && typeof holder !== "function") || holder === null) return undefined;',
  "  return Object.getOwnPropertyDescriptor(holder, entry.isSymbolName ? Symbol[entry.name] : entry.name)?.value;",
  "};",
  "const isConstructor = value => {",
  "  try {",
  "    Reflect.construct(Object, [], value);",
  "    return true;",
  "  } catch {",
  "    return false;",
  "  }",
  "};",
  "const withoutSignature = [];",
  "let compared = 0;",
  "for (const entry of entries) {",
  '  if (entry.sameObjectAs || !entry.overloads.some(overload => overload.mode === "Call")) continue;',
  '  if (entry.overloads.some(overload => overload.mode === "Construct")) continue;',
  "  const value = find(entry);",
  '  if (typeof value !== "function") continue;',
  "  compared++;",
  "  if (isConstructor(value)) withoutSignature.push(entry.path);",
  "}",
  "console.log(JSON.stringify({ withoutSignature, comparesMany: compared > 1000 }));",
  "process.exit(0);",
].join("\n");

test("the table says what `new` does of every function that a program can name and construct", async () => {
  expect(JSON.parse((await runFile(functionsThatCanBeConstructed)).stdout)).toEqual({
    withoutSignature: [],
    comparesMany: true,
  });
});

test("an object of the table passes the instance test of no class that the table keeps it out of", async () => {
  const list: string[] = JSON.parse((await runFile(mismatches)).stdout);
  expect(list.filter(line => line.includes("passes the instance test of"))).toEqual([]);
  const script = [
    'import { aotBuiltinMismatches } from "bun:internal-for-testing";',
    "Object.defineProperty(globalThis, 'Reflect', { value: new Map() });",
    "console.log(JSON.stringify(aotBuiltinMismatches()));",
  ].join("\n");
  expect(JSON.parse((await runFile(script)).stdout)).toContain(
    "Reflect: passes the instance test of Map, and the table says it is no instance",
  );
});

// The flow analysis takes it that what console.log prints finds a method of the host under Symbol.for("nodejs.util.inspect.custom") only where the table lists one.
test("an object of the table that says how it is printed lists the method", async () => {
  const list: string[] = JSON.parse((await runFile(mismatches)).stdout);
  expect(list.filter(line => line.includes("[nodejs.util.inspect.custom]"))).toEqual([]);
  const script = [
    'import { aotBuiltinMismatches } from "bun:internal-for-testing";',
    'Object.getPrototypeOf(setTimeout(Boolean, 0))[Symbol.for("nodejs.util.inspect.custom")] = () => "";',
    "console.log(JSON.stringify(aotBuiltinMismatches()));",
  ].join("\n");
  expect(JSON.parse((await runFile(script)).stdout)).toContain(
    "%Timeout%.prototype[nodejs.util.inspect.custom]: is not in the table",
  );
  // The walk finds no object of a module that nobody has loaded.
  const objectsOfModules = [
    'import { SourceMap } from "node:module";',
    'import { StringDecoder } from "node:string_decoder";',
    'console.log([SourceMap, StringDecoder].filter(made => Object.hasOwn(made.prototype, Symbol.for("nodejs.util.inspect.custom"))).length);',
  ].join("\n");
  expect((await runFile(objectsOfModules)).stdout).toBe("0\n");
  expect(Object.hasOwn(Object.getPrototypeOf(describe), Symbol.for("nodejs.util.inspect.custom"))).toBe(false);
});

test("a mismatch is reported", async () => {
  const script = [
    'import { aotBuiltinMismatches } from "bun:internal-for-testing";',
    "delete Array.prototype.push;",
    "Array.isArray = () => false;",
    "Map.prototype.get = () => 0;",
    "Array.prototype.extra = 1;",
    "Array.prototype[Symbol.match] = 1;",
    "globalThis.extra = 1;",
    "console.log(JSON.stringify(aotBuiltinMismatches()));",
  ].join("\n");
  const list = JSON.parse((await runFile(script)).stdout);
  expect(list).toContain("Array.prototype.push: is missing");
  expect(list).toContain("Array.isArray: has another kind of callee than the table says");
  expect(list).toContain("Map.prototype.get: has another native function than the table says");
  expect(list).toContain("Array.prototype.extra: is not in the table");
  expect(list).toContain("Array.prototype[Symbol.match]: is not in the table");
  expect(list).toContain("globalThis.extra: is not in the table");
});
