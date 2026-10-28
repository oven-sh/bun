// A build is a function of its sources and flags. The files of `inner` have a tsconfig.json that answers `strict` otherwise than the
// entry point's, name the same object types, and import each other in the reverse of the order in which their folder lists them.
import { expect, setDefaultTimeout } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { withoutDebugInformation } from "./harness/commands";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(600_000);

const files = 4;
const threadCounts = [1, 4, 16];

const shared = { target: "esnext", module: "esnext", moduleResolution: "bundler", noEmit: true };

function fileText(index: number): string {
  const next = (index + 1) % files;
  // A build on several threads begins with the longest file.
  const readers = Array.from({ length: 60 * index }, (_, reader) => `read${index}_${reader}`);
  return (
    `import type { DeepA, DeepB, Shared } from "./types";\n` +
    `import { run${next} } from "./code${next}";\n` +
    `export const own${index} = { only${index}: ${index}, also${index}: "text${index}" };\n` +
    `function make${index}(seed: number): Shared {\n` +
    `  const b: DeepB = { label: "b${index}", height: seed };\n` +
    `  const a: DeepA = { inner: b, width: seed + ${index} };\n` +
    `  return { id: seed, name: "n${index}", deep: a };\n}\n` +
    readers
      .map(
        (name, reader) =>
          `function ${name}(x: number, y: string): number { const made = make${index}(x + ${reader}); return made.deep.width + made.deep.inner.height + y.length + made.name.length; }\n`,
      )
      .join("") +
    `export function run${index}(seed: number, depth: number): number {\n` +
    `  const made = make${index}(seed);\n` +
    `  return depth <= 0 ? made.deep.width + own${index}.only${index}${readers.map(name => ` + ${name}(seed, "f")`).join("")} : made.id + run${next}(seed + 1, depth - 1);\n}\n`
  );
}

const sources: Record<string, string> = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { ...shared, strict: true }, include: ["main.ts"] }),
  "main.ts": `import { run0 } from "./inner/code0";\nconsole.log(run0(1, 7));\n`,
  "inner/tsconfig.json": JSON.stringify({ compilerOptions: { ...shared, strict: false } }),
  "inner/types.ts":
    `export interface Shared { id: number; name: string; next?: Shared; deep: DeepA }\n` +
    `export interface DeepA { inner: DeepB; width: number }\n` +
    `export interface DeepB { inner?: DeepA; label: string; height: number }\n`,
};
for (let index = 0; index < files; index++) sources[`inner/code${index}.ts`] = fileText(index);

test("the same bytes at every number of threads", async () => {
  using folder = tempDir("aot-files-of-another-project", sources);
  mkdirSync(join(String(folder), "out"));
  const executable = join(String(folder), "out", isWindows ? "program.exe" : "program");
  const found = new Map<string, number[]>();
  for (const threads of threadCounts) {
    const built = await run(
      [
        bunExe(),
        ...compileCommand,
        withThreads(threads),
        ...withoutDebugInformation(),
        "./main.ts",
        "--outfile",
        executable,
      ],
      String(folder),
    );
    const outcome =
      built.exitCode === 0
        ? new Bun.CryptoHasher("sha256").update(await Bun.file(executable).bytes()).digest("hex")
        : `exit code ${built.exitCode} ${built.stderr.slice(-600)}`;
    found.set(outcome, [...(found.get(outcome) ?? []), threads]);
    rmSync(executable, { force: true });
  }
  expect(
    [...found].map(([outcome, threads]) => ({ outcome: /^[0-9a-f]{64}$/.test(outcome) ? "built" : outcome, threads })),
  ).toEqual([{ outcome: "built", threads: threadCounts }]);
});
