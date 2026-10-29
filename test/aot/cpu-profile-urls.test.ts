// In the CPU profile of a compiled executable a compiled function has what every other function has: a file:// URL, the line of its
// definition and sampled lines, all in the original source.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

const source = `const deadline = Date.now() + 300;
let total = 0;
function hot(n: number): number {
  const squares = new Map<number, number[]>();
  for (let i = 0; i < n; i++) squares.set(i, [i, i * i]);
  let sum = 0;
  for (const [, pair] of squares) sum += pair[1] % 7;
  return sum;
}
while (Date.now() < deadline) total += hot(10_000);
console.log(total > 0);
`;
const lines = source.split("\n");
const definitionLine = lines.indexOf("function hot(n: number): number {");
const lastLine = lines.indexOf("}", definitionLine);

type ProfileNode = {
  callFrame: { functionName: string; url: string; lineNumber: number };
  positionTicks?: { line: number; ticks: number }[];
};

function readNodes(file: string): ProfileNode[] {
  return JSON.parse(readFileSync(file, "utf8")).nodes;
}
const isHot = (node: ProfileNode) => node.callFrame.functionName === "hot";
const definitionLines = (nodes: ProfileNode[]) => [...new Set(nodes.map(node => node.callFrame.lineNumber))];

test("a compiled function in a CPU profile", async () => {
  using dir = tempDir("aot-cpu-profile-urls", { "main.ts": source });
  const cwd = String(dir);
  // With both formats the name gets each format's extension.
  const profilerFlags = "--cpu-prof --cpu-prof-md --cpu-prof-dir=profiles --cpu-prof-name=own";
  built(
    await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        `--compile-exec-argv=${profilerFlags}`,
        "main.ts",
        "--outfile",
        "program",
      ],
      cwd,
      bunEnv,
    ),
  );
  const compiled = await spawned([join(cwd, "program")], cwd, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });

  const nodes = readNodes(join(cwd, "profiles", "own.cpuprofile"));
  const hot = nodes.filter(isHot);
  expect(definitionLines(hot)).toEqual([definitionLine]);
  for (const node of hot) expect(node.callFrame.url).toMatch(/^file:\/\/.*\/main\.ts$/);

  // positionTicks has one-based lines.
  const sampledLines = hot.flatMap(node => node.positionTicks ?? []).map(tick => tick.line);
  expect(sampledLines.filter(line => line <= definitionLine || line > lastLine + 1)).toEqual([]);
  // Only a sample taken while hot() calls into the runtime has a position. Windows' timer resolution allows about 20 samples in 300 ms: too few to guarantee one.
  if (!isWindows) expect(sampledLines).not.toBeEmpty();

  expect(nodes.map(node => node.callFrame.url).filter(url => /^([A-Za-z]:|\/|\\\\)/.test(url))).toEqual([]);

  // The markdown profile shows a path, not a URL, and a one-based line.
  const markdown = readFileSync(join(cwd, "profiles", "own.md"), "utf8");
  const hotLocations = Array.from(markdown.matchAll(/\| `hot` \| `(.*)` \|$/gm), match => match[1]);
  expect(hotLocations).not.toBeEmpty();
  const isInsideHot = (location: string) => {
    const line = Number(/^(?!file:).*[\\/]main\.ts:(\d+)$/.exec(location)?.[1]);
    return line > definitionLine && line <= lastLine + 1;
  };
  expect(hotLocations.filter(location => !isInsideHot(location))).toEqual([]);

  const plain = await spawned(
    [bunExe(), "--cpu-prof", "--cpu-prof-dir=profiles", "--cpu-prof-name=plain.cpuprofile", "main.ts"],
    cwd,
    bunEnv,
  );
  expect(plain.exitCode).toBe(0);
  expect(definitionLines(readNodes(join(cwd, "profiles", "plain.cpuprofile")).filter(isHot))).toEqual([definitionLine]);
}, 120_000);
