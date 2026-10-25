import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const files = {
  "main.ts": `
    declare const process: { argv: string[] };
    declare const console: { log(...values: any[]): void };
    const box: any[] = JSON.parse("[null]");
    function hide(x: any): any { box[0] = x; return box[0]; }
    const emptyText: string = hide("{}");
    function readName(o: any): any { return o.neverStored; }
    function readKey(o: any, k: any): any { return o[k]; }
    let text = "{";
    for (let i = 0; i < 300; i++) text += (i ? "," : "") + JSON.stringify("k" + i) + ":" + i;
    const dictionary = hide(JSON.parse(hide(text + "}")));
    delete dictionary.k7;
    const absent: string = hide("absentFromTheDictionary");
    const turns = Number(process.argv[2]);
    let found = 0;
    for (let i = 0; i < turns; i++) {
      const o = hide(JSON.parse(emptyText));
      o[0] = 1;
      o["n" + i] = i;
      for (let j = 0; j < 16; j++) if (readKey(dictionary, absent) !== undefined) found++;
      if (readName(o) !== undefined) found++;
    }
    console.log(found === 0);
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("the first miss of a Structure and a name is not filed because a dictionary was read in front of it", async () => {
  using dir = tempDir("aot-first-misses-beside-dictionary-reads", files);
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
    const counts = { "operation:operationAOTGetByIdAndCache": 0, "counter:FirstMissesNotFiled": 0 };
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\t");
      if (name !== undefined && name in counts) counts[name as keyof typeof counts] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  const misses = many["operation:operationAOTGetByIdAndCache"] - few["operation:operationAOTGetByIdAndCache"];
  expect(misses).toBeGreaterThanOrEqual(2000);
  expect(many["counter:FirstMissesNotFiled"] - few["counter:FirstMissesNotFiled"]).toBeGreaterThanOrEqual(misses - 200);
}, 240_000);
