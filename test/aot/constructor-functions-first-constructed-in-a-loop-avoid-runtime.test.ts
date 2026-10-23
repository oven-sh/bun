import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    const rounds = Number(process.argv[2]);
    function Point(x) { this.x = x; this.y = 2; }
    Point.prototype.sum = function () { return this.x + this.y; };
    let total = 0;
    for (let i = 0; i < rounds; i++) total += new Point(i).sum();
    console.log(total === rounds * (rounds - 1) / 2 + 2 * rounds);

    function Watched(x) { this.x = x; }
    let seen = 0;
    Object.defineProperty(Watched.prototype, "x", { set(value) { seen += value; }, get() { return -1; } });
    let read = 0;
    for (let i = 0; i < 4; i++) read += new Watched(i).x;
    console.log(seen, read);

    function Replaced() { this.a = 1; }
    Replaced.prototype = { kind: "replaced" };
    let kinds = "";
    for (let i = 0; i < 3; i++) kinds += new Replaced().kind + " ";
    Replaced.prototype = { kind: "replaced again" };
    for (let i = 0; i < 3; i++) kinds += new Replaced().kind + " ";
    console.log(kinds.trim());

    function Fixed(x) { this.x = x; }
    Object.defineProperty(Fixed.prototype, "x", { value: 7, writable: false });
    let refused = 0;
    for (let i = 0; i < 3; i++) {
      try {
        new Fixed(i);
      } catch (error) {
        refused += error instanceof TypeError ? 1 : 100;
      }
    }
    console.log(refused);
  `,
};

const operations = [
  "operationAOTPutById",
  "operationAOTPutByIdAndCache",
  "operationAOTGetConstructPrototype",
  "operationAOTGetById",
];

test("a loop that holds the first construction by a constructor function stops asking the run time", async () => {
  using dir = tempDir("aot-constructor-functions-first-constructed-in-a-loop", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counted = async (rounds: number) => {
    const path = join(String(dir), "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: "true\n6 -4\nreplaced replaced replaced replaced again replaced again replaced again\n3\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(operations.map(name => [name, 0]));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && name in counts) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  // The first construction asks. A renamed operation would count none.
  expect(operations.some(name => few[name]! > 0)).toBe(true);
  const more = Object.fromEntries(
    operations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
  );
  expect(more).toEqual(Object.fromEntries(operations.map(name => [name, "level"])));
}, 240_000);
