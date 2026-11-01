// A loop inside a try block fills the range of the program's objects with one kind of thing. The RangeError comes to the catch clause of that try block, whatever the loop makes:
// the loop has its handler for what it makes, not for its own turns.
import { expect } from "bun:test";
import { test } from "./harness/declare";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported, withoutCoreDump } from "./harness/commands";

const made: Record<string, string> = {
  instances: `new Point(i, i)`,
  wideInstances: `new Wide()`,
  heirs: `new Below(i)`,
  spreads: `{ ...source }`,
  spreadsWithOneMore: `{ ...small, d: i }`,
  listSpreads: `[...list, i]`,
  fieldsAddedLate: `late(i)`,
  boundCalls: `boundPair(i)`,
  proxyReads: `proxied.anything`,
  proxyCalls: `callable(i)`,
  closures: `() => i`,
  generators: `two(i)`,
  texts: `"text " + i + " and more of it"`,
  bigInts: `BigInt(i) + 1n`,
  maps: `new Map([[i, i]])`,
  entries: `Object.entries(small)`,
  assigned: `Object.assign({}, source)`,
  parsed: `JSON.parse('{"a":1,"b":[1,2,3]}')`,
  errors: `new Error("e")`,
  mapped: `list.map(x => x + i)`,
};

const program = `class Point { x: number; y: number; z = 0; constructor(x: number, y: number) { this.x = x; this.y = y; } }
class Wide { a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; h = 8; i = 9; j = 10; k = 11; l = 12; m = 13; n = 14; o = 15; p = 16; q = 17; r = 18; s = 19; t = 20; }
class Below extends Wide { u = 21; v: number; constructor(v: number) { super(); this.v = v; } }
const source: Record<string, number> = {};
for (let i = 0; i < 24; i++) source["name" + i] = i;
const small = { a: 1, b: 2, c: 3 };
const list = [1, 2, 3, 4];
function pair(this: unknown, a: number, b: number) { return [a, b]; }
const boundPair = pair.bind(null, 1);
const proxied = new Proxy({ made: 0 }, { get(target, key) { return { key, n: target.made++ }; } }) as any;
const callable = new Proxy(function (n: number) { return { n }; }, {}) as (n: number) => unknown;
function* two(n: number) { yield n; yield n + 1; }
function late(i: number) { const o: any = { a: i }; o.late = i; o.later = i; o["k" + (i & 7)] = i; return o; }
let caught = 0;
${Object.entries(made)
  .map(
    ([name, expression]) => `function fill_${name}(): boolean {
  const keep: unknown[] = [];
  try {
    for (let i = 0; ; i++) keep.push(${expression});
  } catch (error) {
    caught++;
    return error instanceof RangeError && keep.length > 1000;
  }
}
`,
  )
  .join(
    "",
  )}// Nothing in this loop but the stores makes anything: each gives an object that is there already one more field.
const plain: any[] = [];
for (let i = 0; i < 300_000; i++) plain.push({ a: i });
function fill_fieldsAddedToWhatIsThere(): boolean {
  try {
    for (let i = 0; i < plain.length; i++) {
      const o = plain[i];
${Array.from({ length: 40 }, (_, index) => `      o.f${index} = i;`).join("\n")}
    }
  } catch (error) {
    caught++;
    plain.length = 0;
    return error instanceof RangeError;
  }
  return false;
}
for (const fill of [${Object.keys(made)
  .map(name => "fill_" + name)
  .join(", ")}, fill_fieldsAddedToWhatIsThere]) {
  caught = 0;
  let escaped = 0;
  let answer = false;
  try {
    answer = fill();
  } catch {
    escaped++;
  }
  Bun.gc(true);
  console.log(fill.name + ": " + (escaped ? "outside" : "inside") + " " + caught + " " + answer);
}
`;

test.skipIf(!!unsupported)(
  "a loop inside a try that fills the range gets the RangeError in its own catch, whatever it makes",
  async () => {
    await slot(async () => {
      using dir = tempDir("aot-loops-in-try-fill-the-range", { "entry.ts": program, "tsconfig.json": "{}" });
      const folder = String(dir);
      const executable = join(folder, isWindows ? "entry.exe" : "entry");
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", executable], folder, bunEnv),
      );
      const ran = await spawned(withoutCoreDump([executable]), folder, {
        ...bunEnv,
        BUN_JSC_markedBlockCageSizeInMB: "64",
      });
      expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
        stdout: [...Object.keys(made), "fieldsAddedToWhatIsThere"]
          .map(name => "fill_" + name + ": inside 1 true\n")
          .join(""),
        stderr: "",
        exitCode: 0,
        signal: null,
      });
    });
  },
  240_000,
);
