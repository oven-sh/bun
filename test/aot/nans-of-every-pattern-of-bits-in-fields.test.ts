// NaNs of every pattern of bits on their way into fields that keep a number beside undefined, null and nothing: out of bytes in five ways, through eighteen operators, into four kinds of holders.
// One program holds all of them, each with declarations of its own. It runs under plain Bun and as an --aot executable, with its types and without, and prints the same.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";

const patterns = [
  "0x7ffa000000000000n",
  "0x7ffb000000000000n",
  "0x7ffc000000000000n",
  "0xfffa000000000000n",
  "0xfffc000000000000n",
  "0x7ff8000000000000n",
  "0xfff8000000000000n",
  "0x7ffa000000000001n",
  "0x7ff0000000000001n",
  "0xffffffffffffffffn",
  "0x7ffe000000000000n",
  "0xfffe000000000000n",
];
const sources = {
  float64Array: `new Float64Array(new BigUint64Array([bits]).buffer)[0]!`,
  dataView: `(view.setBigUint64(0, bits), view.getFloat64(0))`,
  buffer: `(bytes.writeBigUInt64LE(bits), bytes.readDoubleLE(0))`,
  float32: `new Float32Array(new Uint32Array([Number(bits >> 32n)]).buffer)[0]!`,
  keptInArray: `((list[1] = new Float64Array(new BigUint64Array([bits]).buffer)[0]!), list[1]!)`,
};
const ways = [
  "x",
  "x + 1",
  "x * 2",
  "-x",
  "Math.abs(x)",
  "Math.max(x, 1)",
  "Math.min(1, x)",
  "Math.fround(x)",
  "Math.sqrt(x)",
  "x ** 1",
  "+x",
  "x - x",
  "(turn & 1 ? x : 1.5)",
  "same(x)",
  "Math.floor(x)",
  "Math.sign(x)",
  "x % 3",
  "1 / x",
];
const holders = [
  (n: number) => [
    `class P${n} { a: number; b: number; constructor(a: number, b: number) { this.a = a; this.b = b; } }`,
    `new P${n}(v, given[turn & 1]!.v)`,
  ],
  (n: number) => [
    `type P${n} = { a: number | undefined; b: number | null };`,
    `({ a: turn % 5 === 4 ? undefined : v, b: turn % 7 === 6 ? null : v } as P${n})`,
  ],
  (n: number) => [
    `type P${n} = { a?: number; b: number };`,
    `((turn % 5 === 4 ? { b: v } : { a: v, b: given[turn & 1]!.v }) as P${n})`,
  ],
  (n: number) => [
    `class P${n} { a: number | undefined = undefined; b: number | null = null; }\nfunction fill${n}(p: P${n}, v: number) { p.a = v; p.b = v; return p; }`,
    `fill${n}(new P${n}(), v)`,
  ],
];

let program = `const view = new DataView(new ArrayBuffer(8));
const bytes = Buffer.alloc(8);
const list = [1.5, 2.5];
function same(x: number) { return x; }
const given = JSON.parse(process.env.GIVEN ?? '[{"v":1.5},{"v":2}]') as { v: number }[];
const patterns = [${patterns.join(", ")}];
function show(v: unknown) { return Object.is(v, -0) ? "-0" : String(v); }
`;
let n = 0;
for (const [name, source] of Object.entries(sources))
  for (const way of ways)
    for (const holder of holders) {
      const [declarations, made] = holder(++n);
      program += `${declarations}
function run${n}(turns: number) {
  let said = "";
  let count = 0;
  for (let turn = 0; turn < turns; turn++) {
    const bits = patterns[turn % patterns.length]!;
    const x = ${source};
    const v = ${way};
    const p = ${made};
    if (p.a === undefined) count += 1;
    if (p.b === null) count += 10;
    if (p.a !== p.a) count += 100;
    if (!("a" in p)) count += 1000;
    if (turn >= turns - patterns.length) said += show(p.a) + "," + show(p.b) + "," + typeof p.a + "," + Object.keys(p).join("") + "," + JSON.stringify(p) + "," + show((p.a ?? 7) + 1) + "," + JSON.stringify({ ...p }) + ";";
  }
  console.log(${JSON.stringify(`${name} ${way} ${n}`)}, count, said);
}
run${n}(40);
run${n}(700);
`;
    }

describe.skipIf(!!unsupported)("compile/aot/nans-of-every-pattern-of-bits-in-fields", () => {
  const folder = String(tempDir("aot-nans-in-fields", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, "program.ts");
  writeFileSync(path, program);
  const plain = spawned([bunExe(), "run", path], folder, bunEnv);

  test.concurrent.each([
    ["with its types", []],
    ["without its types", ["--aot-erase-types"]],
  ])("%s", (_, flags) =>
    slot(async () => {
      const executable = join(folder, "program" + flags.join(""));
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, path, "--outfile", executable],
          folder,
          bunEnv,
        ),
      );
      const compiled = await spawned([executable], folder, bunEnv);
      const reference = await plain;
      expect({ signal: reference.signal, exitCode: reference.exitCode, stderr: reference.stderr }).toEqual({
        signal: null,
        exitCode: 0,
        stderr: "",
      });
      expect({ signal: compiled.signal, exitCode: compiled.exitCode, stderr: compiled.stderr }).toEqual({
        signal: null,
        exitCode: 0,
        stderr: "",
      });
      expect(compiled.stdout.split("\n")).toEqual(reference.stdout.split("\n"));
    }),
  );
});
