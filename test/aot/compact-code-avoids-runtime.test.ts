// One form of code has to be good enough everywhere. Code that the compiler takes for cold is compact: it calls shared pieces where
// hot code has the work in line. It may not ask the run time's C++ for what hot code does by itself: a wrong guess about what is
// cold would then cost hundreds of instructions each time, not a call and a return.
//
// Each idiom is built as usual and with everything taken for cold, and runs a few and many rounds. An operation of the run time
// whose calls grow with the rounds in the compact build, and do not in the usual one, fails the idiom.
//
//   AOT_COMPACT=<text>    only the idioms whose name contains the text
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported-with-counted-calls";

// `round(i)` answers a number. What stands in front of it runs once.
const idioms: Record<string, string> = {
  "instanceof a class": `
    class Point { constructor(x) { this.x = x; } }
    class Other {}
    const values = [new Point(1), new Other(), new Point(2), {}];
    const round = i => (values[i & 3] instanceof Point ? 1 : 0);`,
  "instanceof a constructor function": `
    function Point(x) { this.x = x; }
    function Other() {}
    const values = [new Point(1), new Other(), new Point(2), {}];
    const round = i => (values[i & 3] instanceof Point ? 1 : 0);`,
  "new of a class": `
    class Point { constructor(x, y) { this.x = x; this.y = y; } }
    const round = i => new Point(i, 1).y;`,
  "new of a class below another": `
    class Point { constructor(x) { this.x = x; } }
    class Named extends Point { constructor(x, name) { super(x); this.name = name; } }
    const round = i => new Named(i, "n").name.length;`,
  "new of a constructor function": `
    function Point(x, y) { this.x = x; this.y = y; }
    const round = i => new Point(i, 1).y;`,
  "an object literal": `
    const round = i => ({ a: i, b: 1, c: "c" }).b;`,
  "an object literal without a prototype": `
    const round = i => ({ __proto__: null, a: i, b: 1 }).b;`,
  "Object.create(null)": `
    const round = i => { const table = Object.create(null); table.a = 1; return table.a; };`,
  "a string put together": `
    const names = ["a", "bc", "def"];
    const round = i => ("<" + names[i % 3] + ":" + i + ">").length & 1;`,
  "a template": `
    const names = ["a", "bc", "def"];
    const round = i => \`<\${names[i % 3]}:\${i}>\`.length & 1;`,
  "Object.keys": `
    const object = { a: 1, b: 2 };
    const round = i => Object.keys(object).length - 1;`,
  "a method above": `
    class Point { constructor(x) { this.x = x; } size() { return 1; } }
    class Named extends Point { size() { return super.size(); } }
    const named = new Named(1);
    const round = i => named.size();`,
  "the arguments object": `
    function count() { return arguments.length; }
    const round = i => count(i);`,
  "rest parameters": `
    function count(...values) { return values.length; }
    const round = i => count(i);`,
  "a spread into a literal": `
    const base = { a: 1, b: 2 };
    const round = i => ({ ...base, c: i }).a;`,
  "Object.assign": `
    const base = { a: 1, b: 2 };
    const round = i => Object.assign({ c: i }, base).a;`,
  "a closure": `
    const round = i => (() => i)() * 0 + 1;`,
  "an array literal": `
    const round = i => [i, 1, 2][1];`,
  "a store at a position that is a number": `
    const values = [0, 0, 0, 0];
    const half = Number(process.argv[2]) > 0 ? 0.5 : 0.25;
    const round = i => { values[(i & 3) * half * 2] = i; return 1; };`,
  "stores at positions that are no indexes": `
    const values = [0];
    const positions = [-1, 1e300, -0, 0.5, NaN, 2 ** 63, -(2 ** 63), 4294967295];
    const scale = Number(process.argv[2]) > 0 ? 1 : 2;
    const round = i => { values[positions[i & 7] * scale] = i & 7; return 1; };
    const seen = () => Object.keys(values).join() === "0,-1,1e+300,0.5,NaN,9223372036854776000,-9223372036854776000,4294967295" && values[0] === 2;
    process.on("exit", () => { if (!seen()) console.log(Object.keys(values).join(), values[0]); });`,
  "toLowerCase": `
    const names = ["Content-Type", "ACCEPT", "host"];
    const round = i => names[i % 3].toLowerCase().length & 1;`,
  "a property added later": `
    const round = i => { const object = { a: i }; object.b = 1; return object.b; };`,
  "private fields defined, stored and read": `
    class Point { #x; #y = 1; constructor(x) { this.#x = x; } sum() { return this.#x * 0 + this.#y; } move(x) { this.#x = x; return this; } }
    const round = i => new Point(i).move(i + 1).sum();`,
  "private fields of a class below another": `
    class Point { #x; constructor(x) { this.#x = x; } x() { return this.#x; } }
    class Named extends Point { #name = "n"; size() { return this.#name.length + this.x() * 0; } }
    const round = i => new Named(i).size();`,
  "a private method and a test for a private name": `
    class Point { #x = 1; #one() { return this.#x; } one() { return this.#one(); } static is(value) { return #x in value; } }
    const values = [new Point(), {}, new Point(), []];
    const round = i => (Point.is(values[i & 3]) ? values[i & 3].one() : 1);`,
  "a variable of another module's scope": `
    let total = 0;
    const add = value => { total += value; return 1; };
    const round = i => add(i);`,
};

// TODO: what the compact form of each still asks the run time for.
const asksToday: Record<string, string[]> = {
  "a template": ["operationAOTDoubleToString"],
  "a spread into a literal": ["operationAOTCopyDataProperties"],
  "a string put together": ["operationAOTDoubleToString"],
  "toLowerCase": ["operationAOTStringToLowerCase"],
  "private fields of a class below another": ["operationAOTGetSuperBase"],
};

// Where the usual code knows that it stores into an array, it asks for the same thing under these names.
const asksOfUsualCode: Record<string, string[]> = {
  operationAOTPutByVal: ["operationAOTArrayPutAtNumber", "operationAOTArrayPutAtIndex"],
};

function program(idiom: string) {
  return `${idiom}
    const rounds = Number(process.argv[2]);
    let sum = 0;
    for (let i = 0; i < rounds; i++) sum += round(i);
    console.log(sum >= 0);
  `;
}

async function growthOfOperations(folder: string, name: string, flags: string[]) {
  const executable = join(folder, isWindows ? `${name}.exe` : name);
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "./main.mjs", "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const counted = async (rounds: number) => {
    const path = join(folder, `${name}-${rounds}`);
    const ran = await spawned([executable, String(rounds)], folder, {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      BUN_JSC_aotCountsPath: path,
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
    const counts = new Map<string, number>();
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, operation] = line.split("\toperation:");
      if (operation !== undefined) counts.set(operation, Number(count));
    }
    return counts;
  };
  const [few, many] = [await counted(500), await counted(4500)];
  return [...many]
    .filter(([operation, count]) => count - (few.get(operation) ?? 0) > 400)
    .map(([operation]) => operation);
}

const only = process.env.AOT_COMPACT;

describe.concurrent("compact code asks the run time for no more than the usual code", () => {
  for (const [name, idiom] of Object.entries(idioms)) {
    if (only && !name.includes(only)) continue;
    const known = asksToday[name];
    (known ? test.todo : test)(
      known ? `${name} (${known.join(", ")})` : name,
      async () => {
        using dir = tempDir("aot-compact-code", { "main.mjs": program(idiom) });
        const usual = await growthOfOperations(String(dir), "usual", []);
        const compact = await growthOfOperations(String(dir), "compact", ["--aot-heat=EverythingIsCold"]);
        const isAskedByUsualCode = (operation: string) =>
          [operation, ...(asksOfUsualCode[operation] ?? [])].some(name => usual.includes(name));
        expect(compact.filter(operation => !isAskedByUsualCode(operation)).sort()).toEqual([]);
      },
      240_000,
    );
  }
});
