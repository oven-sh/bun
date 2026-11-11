// Runs alone: the build takes several gigabytes of memory.
import { expect } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// One function carries 46,000 numbers around a loop. The two calls with wrong arguments keep the compiler from trusting the
// declared types, so each read has slow paths, and on ARM64 the function's code is larger than the 128 MB that an unconditional
// branch reaches. The build aborted where it linked the first branch from the loop to a slow path near the end of the function.
function program(count: number) {
  const lines = [
    `const a = new Float64Array(${count}), b = new Int32Array(${count});`,
    "try { big((2) as any, (new Set([1])) as any); } catch {}",
    "try { mix((undefined) as any, (new Map()) as any); } catch {}",
    `for (let i = 0; i < ${count}; i++) { a[i] = i + 0.5; b[i] = i * 3; }`,
    "function mix(s: number, v: number): number { return (s * 33 + v) % 1000000007; }",
    "function big(a: Float64Array, b: Int32Array): number {",
    "let s = 1;",
  ];
  for (let index = 0; index < count; index++) lines.push(`let v${index} = 0;`);
  lines.push("for (let iteration = 0; iteration < 3; iteration++) {");
  for (let index = 0; index < count; index++) lines.push(`v${index} = v${index} + ${"ab"[index % 2]}[${index}];`);
  lines.push("s = mix(s, iteration);", "}");
  for (let index = Math.floor((count * 2) / 3); index < count; index++) lines.push(`s = mix(s, v${index} * 2);`);
  lines.push("return s;", "}", "console.log(big(a, b));");
  return lines.join("\n") + "\n";
}

test.skipIf(!isArm64 || isASAN || isDebug)(
  "a function with more than 128 MB of code builds and runs",
  async () => {
    using dir = tempDir("aot-large-function", { "main.ts": program(46000) });
    const folder = String(dir);
    const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
    await using built = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", executable],
      cwd: folder,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
    expect({ stderr: stderr.split("\n").filter(line => /^(error|panic)/.test(line)), exitCode }).toEqual({
      stderr: [],
      exitCode: 0,
    });
    const said = (cmd: string[]) => Bun.spawnSync({ cmd, cwd: folder, env: bunEnv }).stdout.toString();
    const answer = said([executable]);
    expect(answer).toMatch(/^\d+\n$/);
    expect(answer).toBe(said([bunExe(), "./main.ts"]));
  },
  600_000,
);
