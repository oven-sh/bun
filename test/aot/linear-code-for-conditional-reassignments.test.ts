import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

// One function reads `count` elements. Each is used 150 reads later, so the registers are always full, and most reads follow
// `if (neverTaken) a = ...`. Each such statement makes a new phi for `a`. On ARM64 every phi got a spill slot of its own, and code
// that handled all the slots of the chain at each `if` grew with the square of `count`.
function program(count: number) {
  const replacements = ["1.5", '"s"', "() => 1", "undefined", "[X]", "{ v: X }", "null"];
  const replacement = (index: number, name: string) => replacements[index % replacements.length].replace("X", name);
  const read = (index: number) => {
    const name = "ab"[Math.floor((index * 7) / 3) % 2];
    const guard = index % 3 ? `if (neverTaken) ${name} = (${replacement(index, name)}) as any; ` : "";
    return `${guard}const v${index} = ${name}[${index}];`;
  };
  const use = (index: number) => {
    const guard = index % 4 === 1 ? `if (neverTaken) s = (${replacement(index, "s")}) as any; ` : "";
    return `${guard}s = mix(s, v${index} * 4);`;
  };
  const distance = Math.min(150, count);
  const lines = [
    "var neverTaken = process.argv.length > 99;",
    "const a: number[] = [], b: number[] = [];",
    `for (let i = 0; i < ${count}; i++) { a.push(i + 0.25); b.push(i * 7); }`,
    'function mix(s: number, v: number): number { if (neverTaken) s = ("s") as any; return (s * 33 + v) % 1000000007; }',
    "function big(a: number[], b: number[]): number {",
    "let s = 1;",
  ];
  for (let index = 0; index < count; index++) {
    lines.push(read(index));
    if (index >= distance) lines.push(use(index - distance));
  }
  for (let index = count - distance; index < count; index++) lines.push(use(index));
  lines.push("return s;", "}", "console.log(big(a, b));");
  return lines.join("\n") + "\n";
}

async function sizeOfExecutable(count: number) {
  using dir = tempDir("aot-conditional-reassignments", { "main.ts": program(count) });
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
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  const said = (cmd: string[]) => Bun.spawnSync({ cmd, cwd: folder, env: bunEnv }).stdout.toString();
  expect(said([executable])).toBe(said([bunExe(), "./main.ts"]));
  return statSync(executable).size;
}

test("four times the reassignments take four times the code, not sixteen", async () => {
  const [none, few, many] = await Promise.all([sizeOfExecutable(0), sizeOfExecutable(1500), sizeOfExecutable(6000)]);
  const growth = (many - none) / (few - none);
  reads("four times the conditional reassignments", growth, 5, "times the code");
  expect(growth).toBeLessThan(5);
}, 240_000);
