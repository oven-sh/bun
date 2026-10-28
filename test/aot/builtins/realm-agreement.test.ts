import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told } from "../harness/commands";
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

// TODO: the table says that self is a value, and names another object above the prototype of EventEmitter than the realm has.
test.todo("the table agrees with the realm of bun run", async () => {
  expect(JSON.parse((await runFile(mismatches)).stdout)).toEqual([]);
});

// TODO: the walk prints nothing in an executable.
test.todo(
  "the table agrees with the locked realm of an executable",
  () =>
    slot(async () => {
      using dir = tempDir("aot-realm-agreement", { "main.mjs": mismatches + "\n" });
      const folder = String(dir);
      const executable = await buildExecutable(folder);
      const ran = await spawned([executable], folder, bunEnv);
      expect({ mismatches: JSON.parse(ran.stdout), exitCode: ran.exitCode, signal: ran.signal }).toEqual({
        mismatches: [],
        exitCode: 0,
        signal: null,
      });
    }),
  600_000,
);

// The flow analysis takes `globalThis.name` for absent where the table lists no such member and no statement stores one. So the table has to list every own name
// that the engine and the host give the global object, also those that appear when another is touched, and nothing but Object.prototype may lie above it.
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
  "console.log(JSON.stringify({ unlisted, isBelowObjectPrototype: Object.getPrototypeOf(globalThis) === Object.prototype }));",
].join("\n");

test("the table lists every own name of the global object but ShadowRealm, which a compiled program does not have", async () => {
  expect(JSON.parse((await runFile(namesOfGlobalObject)).stdout)).toEqual({
    unlisted: ["ShadowRealm"],
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
        names: { unlisted: [], isBelowObjectPrototype: true },
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

// TODO: the executable aborts.
test.todo(
  "calling a built-in that is missing from the realm throws a TypeError",
  () =>
    slot(async () => {
      using dir = tempDir("aot-realm-agreement", {
        "main.mjs":
          'try {\n  new Date(0).toTemporalInstant();\n  console.log("returned");\n} catch (error) {\n  console.log(error instanceof TypeError);\n}\n',
      });
      const folder = String(dir);
      const executable = await buildExecutable(folder);
      const env = { ...bunEnv, BUN_JSC_useTemporal: "0" };
      const [plain, ran, enabled] = await Promise.all([
        spawned([bunExe(), "run", "main.mjs"], folder, env),
        spawned([executable], folder, env),
        spawned([executable], folder, bunEnv),
      ]);
      expect(plain.stdout).toBe("true\n");
      expect(ran.signal).toBeNull();
      expect(told(ran)).toEqual(told(plain));
      expect(enabled.stdout).toBe("returned\n");
    }),
  600_000,
);
