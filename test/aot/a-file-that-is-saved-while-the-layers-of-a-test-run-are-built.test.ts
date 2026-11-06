// The layers that the test files of a run share are built by processes of their own, and that takes seconds. A developer saves a file meanwhile, and many
// editors save in place. What a builder has read is its own from then on. Where the text of a file was the file itself, mapped into the builder, a file that
// got shorter took the last pages away from under the text, and the run ended with "a source file was made shorter while it was being compiled".
//
// Nothing tells a test when a builder has read a file. So the file gets shorter all the time, by more than a page at each step. What the test files import
// stands at its top and each cut is behind the end of a function: whatever a process of the run reads, and whenever, is a program that passes.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { truncateSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const steps = 200;
const functionsOfStep = 400;
const add = (name: string | number, by: number) =>
  `export function add${name}(n: number): number {\n  return n + ${by};\n}\n`;
const top = add("One", 1) + add("Two", 2);
const parts = Array.from({ length: steps }, (_, step) =>
  Array.from({ length: functionsOfStep }, (_, index) => add(step * functionsOfStep + index, index)).join(""),
);

const project = {
  "package.json": `{ "name": "saved-while-built", "type": "module" }\n`,
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "module": "preserve", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "noEmit": true } }\n`,
  "src/large.ts": top + parts.join(""),
  ...Object.fromEntries(
    ["first", "second"].map(name => [
      `tests/${name}.test.ts`,
      `import { expect, test } from "bun:test";\nimport { addOne, addTwo } from "../src/large.ts";\n` +
        `test("${name}", () => {\n  expect([addOne(1), addTwo(1)]).toEqual([2, 3]);\n});\n`,
    ]),
  ),
};

test("a file gets shorter and shorter while the layers of a test run are built", async () => {
  expect(Math.min(...parts.map(part => part.length))).toBeGreaterThan(16 * 1024);
  using dir = tempDir("aot-saved-while-built", project);
  const path = join(String(dir), "src", "large.ts");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--aot", "--isolate"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = Promise.all([proc.stdout.text(), proc.stderr.text()]);
  let hasEnded = false;
  const ended = proc.exited.then(() => void (hasEnded = true));
  // As long as the run lasts: each step waits a little longer than the one before, so that a run that takes a minute is still met by a cut.
  let length = project["src/large.ts"].length;
  let cuts = 0;
  for (let step = steps - 1; step >= 0 && !hasEnded; step--) {
    await Promise.race([ended, Bun.sleep(10 + (steps - step) * 2)]);
    if (hasEnded) break;
    length -= parts[step].length;
    try {
      truncateSync(path, length);
    } catch (error) {
      // Windows refuses the cut while something holds the file without sharing writing, a virus scanner for one. The next step cuts further.
      if (!isWindows || !["EBUSY", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code!)) throw error;
      continue;
    }
    cuts++;
  }
  const exitCode = await proc.exited;
  const [stdout, stderr] = await output;
  const errors = stderr.split("\n").filter(line => /^error|made shorter|panic/i.test(line));
  expect({ errors, passed: /^ *(\d+) pass$/m.exec(stderr + stdout)?.[1], exitCode }).toEqual({
    errors: [],
    passed: "2",
    exitCode: 0,
  });
  expect(cuts).toBeGreaterThan(10);
}, 240_000);
