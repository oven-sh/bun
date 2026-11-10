// The stub that starts a file calls what the run time has for files that throw, are mocked or are loaded again, and for errors that compiled code makes.
// An executable holds that stub only where a file has a start that the run time enters: a program of one file has none, and under --trim it keeps neither of the two.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const calledByStartsOfFiles = [
  "what compiled code calls for modules that throw, are mocked or are loaded again",
  "what compiled code calls for errors that compiled code makes and throws",
];

async function featuresKeptBy(files: Record<string, string>, entry: string) {
  using dir = tempDir("aot-features-of-starts-of-files", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", entry],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return [...stderr.matchAll(/^aot: trim: kept (.+): /gm)].map(line => line[1]);
}

test("a program of one file keeps neither", async () => {
  const kept = await featuresKeptBy({ "main.ts": "console.log(1);\n" }, "main.ts");
  expect(kept).not.toBeEmpty();
  expect(kept.filter(feature => calledByStartsOfFiles.includes(feature))).toEqual([]);
}, 600_000);

test("a program of two files keeps both", async () => {
  const kept = await featuresKeptBy(
    {
      "harbor.mjs": "export const berths = 1;\nexport function moor() {\n  return 2;\n}\n",
      "main.mjs": 'import { berths, moor } from "./harbor.mjs";\nconsole.log(berths, moor());\n',
    },
    "main.mjs",
  );
  expect(kept.filter(feature => calledByStartsOfFiles.includes(feature))).toEqual(calledByStartsOfFiles);
}, 600_000);
