// Runs alone: it judges by the memory that a build holds.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

// A tsconfig.json without "include" takes in every file under its folder: tests, scripts, other programs. A build reads
// them for the globals that they may declare. A module declares none, so nothing of it is needed unless something imports it.
const files = {
  "tsconfig.json": "{}",
  "shapes/shape.ts": `
    export interface Shape { name: string; size: number }
    export function unused(shape: Shape): number { return shape.size; }
  `,
  "app/main.ts": `
    import type { Shape } from "../shapes/shape";
    const shape: Shape = { name: "square", size: 4 };
    console.log(shape.name, shape.size + 1);
  `,
};

function moduleText(index: number): string {
  const lines = [
    index % 100 ? `import { first${index - 1} } from "./module-${index - 1}";` : "",
    `export interface Row${index} { name: string; size: number; next?: Row${index} }`,
    `export function first${index}(size: number): number { return size + ${index}; }`,
  ];
  for (let i = 0; i < 200; i++) {
    lines.push(
      `export function work${index}_${i}(row: Row${index}, count: number): string {`,
      `  let text = row.name;`,
      `  for (let i = 0; i < count; i++) text = i % 3 === ${i % 3} ? text + String(row.size * i) : text.slice(1) + "-";`,
      `  return text;`,
      `}`,
    );
  }
  return lines.join("\n") + "\n";
}

async function build(folder: string) {
  const executable = join(folder, "main" + (isWindows ? ".exe" : ""));
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", executable],
    cwd: join(folder, "app"),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  await using ran = Bun.spawn({ cmd: [executable], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect({ stdout: await ran.stdout.text(), exitCode: await ran.exited }).toEqual({
    stdout: "square 5\n",
    exitCode: 0,
  });
  return built.resourceUsage()!.maxRSS;
}

test("a build holds neither the text nor the tree of the modules of its project that nothing imports", async () => {
  using dir = tempDir("aot-modules-that-nothing-imports", files);
  const folder = String(dir);
  const alone = await build(folder);
  // Far more files than a load reads ahead of its parsers, so that what is on its way at one moment does not decide.
  let bytes = 0;
  for (let index = 0; index < 3000; index++) {
    if (index % 100 === 0) mkdirSync(join(folder, "other", String(index / 100)), { recursive: true });
    const text = moduleText(index);
    bytes += text.length;
    writeFileSync(join(folder, "other", String(Math.floor(index / 100)), `module-${index}.ts`), text);
  }
  expect(bytes).toBeGreaterThan(96 * 1024 * 1024);
  const beside = await build(folder);
  // It held 1.3 to 1.8 times their text. What is left is a record for each file, and what each thread has just freed.
  // An allocator that checks for errors holds on to what is freed.
  reads("what a build holds of modules that nothing imports", (beside - alone) / bytes, 1, "times their text");
  if (!isASAN && !isDebug) expect((beside - alone) / bytes).toBeLessThan(1);
}, 240_000);
