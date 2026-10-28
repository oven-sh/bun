import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const files = {
  "main.mjs": `
    const argc = process.argv.length;
    const parse = text => JSON.parse(argc > 90 ? "[]" : text);
    const many = prefix => JSON.stringify(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [prefix + i, i])));

    const d = parse(many("k"));
    Object.assign(d, parse(many("m")));
    let sum = 0;
    for (let i = 0; i < 40; i++) if (d.nothing === undefined) sum++;
    Object.assign(d, parse(many("n")));
    const before = process.title;
    for (let i = 0; i < 20; i++) if (d.absentByName === undefined) sum++;
    const afterReadsByName = process.ppid;
    const missing = ["absentByKey", "k1"][argc > 90 ? 1 : 0];
    for (let i = 0; i < 20; i++) if (d[missing] === undefined) sum++;
    const afterReadsByKey = process.exitCode;
    console.log(sum, typeof before, typeof afterReadsByName, typeof afterReadsByKey);
  `,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("the sixteenth read of a name that a dictionary lacks does not make the next first miss count as a later one", async () => {
  using dir = tempDir("aot-a-miss-that-a-dictionary-answers", files);
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
  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  expect(await run([executable], String(dir), env)).toEqual({
    stdout: "80 string number undefined\n",
    stderr: "",
    exitCode: 0,
  });
  const misses: Record<string, string[]> = { title: [], ppid: [], exitCode: [] };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [, which, name] = line.match(/\tnamed:miss by name:read:(first|later):(\w+)$/) ?? [];
    if (name !== undefined && name in misses) misses[name]!.push(which!);
  }
  expect(misses).toEqual({ title: ["first"], ppid: ["first"], exitCode: ["first"] });
}, 240_000);
