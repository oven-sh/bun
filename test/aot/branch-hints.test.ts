import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = { "main.mjs": readFileSync(join(import.meta.dir, "branch-hints.fixture.mjs"), "utf8") };

async function build(dir: string, name: string, flags: string[]) {
  const executable = join(dir, name + (isWindows ? ".exe" : ""));
  const map = join(dir, name + ".map");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, "main.mjs", "--outfile", executable],
    dir,
    { ...bunEnv, BUN_JSC_aotMapFilePath: map },
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const hints = readFileSync(map, "utf8")
    .split("\n")
    .filter(line => line.startsWith("W\t"))
    .map(line => line.split("\t").slice(1));
  expect(hints.filter(fields => fields.length !== 4)).toEqual([]);
  expect(
    hints.filter(
      ([path, position, targetIndex]) => path === "" || !/^\d+$/.test(position) || !/^\d+$/.test(targetIndex),
    ),
  ).toEqual([]);
  return { executable, frequencies: [...new Set(hints.map(([, , , frequency]) => frequency))].sort() };
}

test("--aot-testing=ignore-branch-hints drops the hints of unlikely blocks and keeps those of rare blocks", async () => {
  using dir = tempDir("aot-branch-hints", files);
  const honored = await build(String(dir), "honored", []);
  expect(honored.frequencies).toEqual(["Rare", "Unlikely"]);
  const ignored = await build(String(dir), "ignored", ["--aot-testing=ignore-branch-hints"]);
  expect(ignored.frequencies).toEqual(["Rare"]);

  const plain = await run([bunExe(), "run", "main.mjs"], String(dir), bunEnv);
  expect(plain.exitCode).toBe(0);
  for (const { executable } of [honored, ignored]) {
    const compiled = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }
}, 480_000);
