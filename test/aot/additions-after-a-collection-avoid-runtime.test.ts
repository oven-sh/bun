import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const files = {
  "main.ts": `
    declare const process: { argv: string[] };
    declare const console: { log(...values: any[]): void };
    declare const Bun: { gc(force: boolean): void };
    const box: any[] = JSON.parse("[null]");
    function hide(x: any): any { box[0] = x; return box[0]; }
    const emptyText: string = hide("{}");
    const keys: string[] = hide(["alpha", "beta", "gamma", "delta", "epsilon"]);
    function build(v: number): any {
      const o = hide(JSON.parse(emptyText));
      for (let i = 0; i < keys.length; i++) o[keys[i]] = v;
      return o;
    }
    const turns = Number(process.argv[2]);
    const kept = build(1);
    Bun.gc(true);
    let sum = 0;
    for (let i = 0; i < turns; i++) sum += build(1).epsilon;
    console.log(sum === turns && Object.keys(kept).join() === Object.keys(build(2)).join());
  `,
};

const operations = ["operationAOTPutByValGeneric", "operationAOTPutByVal", "operationAOTPutByValAndCache"];

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("an object built key by key once before a collection is built without the run time after it", async () => {
  using dir = tempDir("aot-additions-after-a-collection", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counted = async (turns: number) => {
    const path = join(String(dir), "counts" + turns);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(turns)], String(dir), env)).toEqual({
      stdout: "true\n",
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
  // The first builds miss their caches. A renamed operation would count none.
  expect(operations.some(name => few[name]! > 0)).toBe(true);
  expect(
    Object.fromEntries(
      operations.map(name => [name, many[name]! - few[name]! > 200 ? many[name]! - few[name]! : "level"]),
    ),
  ).toEqual(Object.fromEntries(operations.map(name => [name, "level"])));
}, 240_000);
