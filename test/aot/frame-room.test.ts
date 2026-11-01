import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { withReport, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const fields = (count: number, first: string) =>
  `{ a: ${first}${Array.from({ length: count - 1 }, (_, index) => `, f${index}: ${index}`).join("")} }`;

function sourceWith(objects: number, fieldsOfEach: number) {
  const lines = (line: (index: number) => string) => Array.from({ length: objects }, (_, index) => line(index) + "\n");
  return [
    "const seed = process.argv.length;\nfunction big() {\n  let s = seed;\n",
    ...lines(
      i =>
        `  let v${i} = (seed + ${i}) % 3 ? ${fields(fieldsOfEach, `${i}`)} : ${fields(fieldsOfEach, `${i} + seed`)};`,
    ),
    ...lines(i => `  if (s & 1) s += ${i}; else s ^= ${i + 1};`),
    ...lines(i => `  s += v${i}.a;`),
    "  return s;\n}\nconsole.log(big());\n",
  ].join("");
}

async function build(objects: number, fieldsOfEach: number) {
  using dir = tempDir("aot-frame-room", { "main.mjs": sourceWith(objects, fieldsOfEach) });
  const directory = String(dir);
  const executable = join(directory, `program${isWindows ? ".exe" : ""}`);
  const report = join(directory, "report.json");
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      withThreads(1),
      ...withReport(report, "summary"),
      "main.mjs",
      "--outfile",
      executable,
    ],
    directory,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const [compiled, plain] = await Promise.all([
    run([executable], directory),
    run([bunExe(), "main.mjs"], directory, bunEnv),
  ]);
  expect(compiled.stdout).toBe(plain.stdout);
  const { CellsWithoutRoomInFrames = 0, ObjectsInFrames = 0 } = readBuildReport(report).statistics;
  return { onHeapForWantOfRoom: CellsWithoutRoomInFrames, inFrames: ObjectsInFrames };
}

const bytesOfCellWith32Fields = 16 + 33 * 8 + 8;
const room = 524_288;
const most = Math.floor(room / bytesOfCellWith32Fields);

// The two literals of a `let` differ in one value and become one allocation behind the branch.
test("as many objects as the frame has room for lie in it", async () => {
  expect(await build(most, 32)).toEqual({ onHeapForWantOfRoom: 0, inFrames: most });
}, 240_000);

test("the objects that the frame has no room for are on the heap", async () => {
  expect(await build(most + 10, 32)).toEqual({ onHeapForWantOfRoom: 10, inFrames: most });
}, 240_000);

test("24,000 small objects alive in one function", async () => {
  expect(await build(24_000, 1)).toEqual({ onHeapForWantOfRoom: 48_000 - room / 32, inFrames: room / 32 });
}, 600_000);
