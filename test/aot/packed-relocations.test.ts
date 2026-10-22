import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { readElfFile } from "./elf-file";
import { test } from "./supported";

const sizeInBun = isLinux ? readElfFile(bunExe()).packedRelocationsSize : 0;

async function run(cmd: string[]) {
  await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(sizeInBun === 0)("an executable of a Bun built with --relr=on leaves out the packed relocations of what it removed", async () => {
  using dir = tempDir("aot-packed-relocations", { "program.ts": `console.log([1, 2, 3].map((n: number) => n * 2).join());\n` });
  const executable = join(String(dir), "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", join(String(dir), "program.ts"), "--outfile", executable]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  expect(await run([executable])).toEqual({ stdout: "2,4,6\n", stderr: "", exitCode: 0 });
  const size = readElfFile(executable).packedRelocationsSize;
  expect(size).toBeGreaterThan(0);
  expect(size).toBeLessThan(sizeInBun);
}, 120_000);
