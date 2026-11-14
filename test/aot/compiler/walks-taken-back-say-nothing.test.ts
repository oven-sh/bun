import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "../supported";

// A version of the loop is begun, fails and is taken back: the build ends with 0, and its answer is right.
const source = `function work(n) {
  let s = 0;
  let n2 = 1;
  let ys = [1, "a", 2];
  const at = [2, 0, 1, 3];
  const box = { v: 0, l: Array.from({ length: 9 }, (_, k) => k * 2) };
  for (let i = n; i-- > 0; ) {
    s += box.l[i];
    s += [ys[at[i & 3]], ys[i + n2]][i & 1];
  }
  return s;
}
for (const n of [5, 8]) {
  try {
    console.log(work(n));
  } catch (error) {}
}
`;

test("a build says nothing of a walk that it takes back", async () => {
  using dir = tempDir("walk-taken-back", { "main.mjs": source });
  const outfile = join(String(dir), process.platform === "win32" ? "main.exe" : "main");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--no-install", "--compile", "--aot", "./main.mjs", "--outfile", outfile],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect((out + err).split("\n").filter(line => line.startsWith("AOT: "))).toEqual([]);
  expect(exitCode).toBe(0);

  await using run = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  await using plain = Bun.spawn({
    cmd: [bunExe(), "--no-install", "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [answer, expected] = await Promise.all([run.stdout.text(), plain.stdout.text()]);
  expect(answer).toBe(expected);
  expect(await run.exited).toBe(0);
}, 120_000);
