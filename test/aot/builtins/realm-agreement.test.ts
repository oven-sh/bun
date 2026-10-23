import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told } from "../run-programs";
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

test("the table lists every own name of the global object", async () => {
  expect(JSON.parse((await runFile(namesOfGlobalObject)).stdout)).toEqual({
    unlisted: [],
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
