import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

const program = `
const glob = new Bun.Glob("*.ts");
const hasher = new Bun.CryptoHasher("sha1");
let matches = 0;
for (let i = 0; i < 100; i++) matches += glob.match("file" + i + (i % 2 ? ".ts" : ".js")) ? 1 : 0;
hasher.update("abc");
console.log(matches, hasher.digest("hex"));
`;

const countIn = (output: string) => Number(/^NativeFunctionsCalledDirectly (\d+)$/m.exec(output)?.[1] ?? 0);

test("a method of a class of the host is entered at its native function where the receiver is known", async () => {
  using dir = tempDir("aot-methods-of-host-classes", { "main.ts": program });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const build = await spawned(
    [bunExe(), ...compileCommand, "--explain=statistics", "main.ts", "--outfile", executable],
    folder,
    env,
  );
  built(build);
  expect(countIn(build.stdout + build.stderr)).toBeGreaterThanOrEqual(3);

  const plain = await spawned([bunExe(), "main.ts"], folder, env);
  expect(plain.exitCode).toBe(0);
  expect(await spawned([executable], folder, env)).toEqual(plain);
}, 300_000);
