// CI's runner deals test files by two lists, and both take a file that they do not know for a fast one.
//   ../expected-durations.json    how long a file takes on each lane. The files of a shard, and those that run side by side, are chosen by it.
//   ../parallel-allowlist.json    every file of a folder in `dirs` that is not in `excludeFiles` runs in one process with the others of its shard, which is
//                                 ended after ten minutes. What was under way then runs again. The list's own rule: at most 15 s on the slowest lane.
// 290 files of this folder that take half a minute and more were in neither, four of them were dealt into one window and passed their limits, and with a
// sanitizer 329 ran twice. So every test file of this folder that CI runs (harness/every-build.ts) is in the first list, and one that is long there is in
// `excludeFiles` of the second. A file that CI leaves out takes no time there: it needs no entry, and one that it has says half a second.
//
//   AOT_CI_LISTS_UPDATE=1 bun test test/aot/ci-lists.test.ts                            enters what is missing: a file that nobody has timed counts as long
//   AOT_CI_LISTS_UPDATE="mock-ends.test.ts=12 perf/stay-calls-1.test.ts=90" bun test ..  with the seconds that a file took in your gate. With a sanitizer: four times that.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { everyBuild } from "./harness/every-build";

const folderOfTests = join(import.meta.dir, "..");
const durationsPath = join(folderOfTests, "expected-durations.json");
const allowlistPath = join(folderOfTests, "parallel-allowlist.json");
const longestInTheBucket = 15_000;
// What a file counts for until somebody has timed it.
const ofAFileNobodyTimed = 60;
const timesAsLongWithASanitizer = 4;

// The stored programs are the driver's, and a test file below a project is the project's.
const isOurs = (path: string) =>
  /\.test\.(?:ts|tsx|js|mjs|cjs)$/.test(path) && !/(?:^|\/)(?:node_modules|parallel|programs|fixtures?)\//.test(path);
const testFiles = readdirSync(import.meta.dir, { recursive: true, encoding: "utf8" })
  .map(path => path.replaceAll("\\", "/"))
  .filter(isOurs)
  .map(path => `aot/${path}`)
  .filter(path => everyBuild.has(path))
  .sort();

type Durations = Record<string, Record<string, number>>;
const slowest = (entry: Record<string, number>) =>
  Math.max(...Object.values(entry).filter(it => typeof it === "number"));

function read() {
  const durations: Durations = JSON.parse(readFileSync(durationsPath, "utf8"));
  const { dirs, excludeFiles }: { dirs: string[]; excludeFiles: string[] } = JSON.parse(
    readFileSync(allowlistPath, "utf8"),
  );
  const notTimed = testFiles.filter(file => !(file in durations));
  const isInBucket = (file: string) =>
    dirs.includes(file.slice(0, file.lastIndexOf("/"))) && !excludeFiles.includes(file);
  const tooLongForTheBucket = testFiles.filter(
    file => file in durations && slowest(durations[file]) > longestInTheBucket && isInBucket(file),
  );
  return { notTimed, tooLongForTheBucket };
}

// Both files are kept as they are written: an entry goes in front of the first of this folder, a name behind the last of its list.
function update(given: string) {
  const seconds = new Map(
    given.split(/\s+/).flatMap(word => (word.includes("=") ? [word.split("=") as [string, string]] : [])),
  );
  const { notTimed } = read();
  if (notTimed.length) {
    const text = readFileSync(durationsPath, "utf8");
    const at = text.indexOf('  "aot/');
    const entries = notTimed.map(file => {
      const took = Math.round(Number(seconds.get(file.slice("aot/".length)) ?? ofAFileNobodyTimed) * 10) * 100;
      return `  ${JSON.stringify(file)}: {\n    "default": ${took},\n    "asan": ${took * timesAsLongWithASanitizer}\n  },\n`;
    });
    writeFileSync(durationsPath, text.slice(0, at) + entries.join("") + text.slice(at));
  }
  const { tooLongForTheBucket } = read();
  if (tooLongForTheBucket.length) {
    const text = readFileSync(allowlistPath, "utf8");
    const end = text.indexOf("\n  ]", text.indexOf('"excludeFiles": ['));
    writeFileSync(
      allowlistPath,
      text.slice(0, end) + tooLongForTheBucket.map(file => `,\n    ${JSON.stringify(file)}`).join("") + text.slice(end),
    );
  }
}

test("CI's runner knows how long every test file of this folder that it runs takes, and runs no long one in the bucket", () => {
  if (process.env.AOT_CI_LISTS_UPDATE) update(process.env.AOT_CI_LISTS_UPDATE);
  const command = `AOT_CI_LISTS_UPDATE="<file below test/aot>=<the seconds it took> .." bun test test/aot/ci-lists.test.ts`;
  const notTimed = `not in test/expected-durations.json, so CI takes it for a fast file. This enters it, to land with the test: ${command}`;
  const tooLong = `over 15 s in test/expected-durations.json and not in excludeFiles of test/parallel-allowlist.json. This enters it: ${command}`;
  const found = read();
  expect({ [notTimed]: found.notTimed, [tooLong]: found.tooLongForTheBucket }).toEqual({
    [notTimed]: [],
    [tooLong]: [],
  });
});
