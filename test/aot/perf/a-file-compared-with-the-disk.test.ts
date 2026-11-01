// In a test run that may read its files again from disk, a realm looks at each file of the program on disk before it first loads it: `bun test` reads what is there by then.
// A large project loads ten thousand files in each of its test files' realms, so what the look costs beside the system call is paid millions of times in a run.
// It put the path together out of its folders' names, as a string, and copied that twice: 3,700 instructions a file more than a file that is not looked at. A folder's path is put together
// once a realm: 1,200.
// ./count-steps.ts counts the instructions between two marks round an import of n and of 2 n files that lie seven folders deep.
import { expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isMusl, tempDir } from "harness";
import { join } from "path";
import { slot, spawned } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { describe, test } from "../supported";
import { whyNoSteps } from "./step-idioms";

const files = 200;
const most = 1400;
/** Two switches of context an instruction: seconds of work take minutes where the processors are taken. */
const limitOfSteppedRun = 840_000;
const folders = "src/deep/er/than/most/folders/are";

function writeProject(folder: string, count: number, readsFilesAgain: boolean) {
  const indexes = Array.from({ length: count }, (_, index) => index);
  mkdirSync(join(folder, folders), { recursive: true });
  writeFileSync(join(folder, "package.json"), `{ "name": "p", "type": "module" }`);
  for (const index of indexes)
    writeFileSync(join(folder, folders, `m${index}.js`), `export const v${index} = ${index};\n`);
  writeFileSync(join(folder, "src/other.js"), `export const other = 1;\n`);
  writeFileSync(
    join(folder, "src/all.js"),
    `${indexes.map(index => `import { v${index} } from "./${folders.slice(4)}/m${index}.js";`).join("\n")}\nexport const sum = ${indexes.map(index => `v${index}`).join(" + ")};\n`,
  );
  // Which file leaves require.cache only the run knows, so any file of the program may be read again.
  const takesFilesOut = `for (const key of Object.keys(require.cache)) if (key.endsWith(process.env.NO_SUCH_NAME ?? "other.js")) delete require.cache[key];`;
  writeFileSync(
    join(folder, "a.test.js"),
    `import { expect, test } from "bun:test";
test("a", async () => {
  ${readsFilesAgain ? takesFilesOut : ""}
  process.kill(process.pid, "SIGUSR2");
  const { sum } = await import("./src/all.js");
  process.kill(process.pid, "SIGUSR2");
  expect(sum).toBe(${(count * (count - 1)) / 2});
});
`,
  );
}

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isMusl
      ? "./count-steps.ts opens glibc"
      : whyNoSteps(bunExe());
if (skipped) console.error(`SKIPPED: test/aot/perf/a-file-compared-with-the-disk.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/a-file-compared-with-the-disk", () => {
  if (skipped) return;
  const root = String(tempDir("aot-a-file-compared-with-the-disk", {}));

  const stepsOf = (count: number, readsFilesAgain: boolean) =>
    slot(async () => {
      const folder = join(root, `${count}-${readsFilesAgain}`);
      writeProject(folder, count, readsFilesAgain);
      const command = [
        bunExe(),
        join(import.meta.dir, "count-steps.ts"),
        bunExe(),
        "test",
        "--aot",
        "--isolate",
        "--timeout=900000",
        "a.test.js",
      ];
      const env = { ...bunEnv, ...withSteadyCollections, NO_COLOR: "1" };
      const { stderr } = await spawned(command, folder, env, limitOfSteppedRun);
      const [, steps, marks] = /^steps (\d+) compiled \d+ marks (\d)$/m.exec(stderr) ?? [];
      if (marks !== "2" || !/^ 1 pass$/m.test(stderr)) throw new Error(`no steps: ${stderr}`.slice(0, 600));
      return Number(steps);
    });
  const aFile = async (readsFilesAgain: boolean) => {
    const [few, many] = await Promise.all([stepsOf(files, readsFilesAgain), stepsOf(2 * files, readsFilesAgain)]);
    return Math.round((many - few) / files);
  };

  test(`at most ${most} instructions more than the load of a file that is not looked at`, async () => {
    const [looked, notLooked] = await Promise.all([aFile(true), aFile(false)]);
    console.error(`A FILE COMPARED WITH THE DISK\t${looked}\t| not looked at\t${notLooked}`);
    expect({ looked, notLooked, isWithin: looked <= notLooked + most }).toEqual({ looked, notLooked, isWithin: true });
  }, 900_000);
});
