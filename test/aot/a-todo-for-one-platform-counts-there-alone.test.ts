// run-parallel.ts: `// Todo on <process.platform> <process.arch>: <why>` is a `// Todo:` on that platform and nothing on any other.
// `// Todo under ASAN: <why>` is one where Bun is built with the address sanitizer and nothing anywhere else.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const here = `${process.platform} ${process.arch}`;
const right = "console.log(true);\n/* Output:\ntrue\n*/\n";
const wrong = "console.log(true);\n/* Output:\nfalse\n*/\n";
const expected = {
  "wrong-here.js": "skip: todo: some day",
  "wrong-elsewhere.js": "compare: it does not print what its last comment says",
  "right-here.js": "todo: it passes: its `// Todo:` line goes out",
  "right-elsewhere.js": "pass",
  "the-line-for-here-goes-first.js": "skip: todo: Not every time: some day",
  "wrong-under-asan.js": isASAN ? "skip: todo: some day" : "compare: it does not print what its last comment says",
  "right-under-asan.js": isASAN ? "todo: it passes: its `// Todo:` line goes out" : "pass",
};

test("a todo for one platform counts there alone", async () => {
  using dir = tempDir("a-todo-for-one-platform-counts-there-alone", {
    "tsconfig.json": "{}",
    "wrong-here.js": `// Todo on ${here}: some day\n${wrong}`,
    "wrong-elsewhere.js": `// Todo on plan9 mips: some day\n${wrong}`,
    "right-here.js": `// Todo on ${here}: some day\n${right}`,
    "right-elsewhere.js": `// Todo on plan9 mips: some day\n${right}`,
    "the-line-for-here-goes-first.js": `// Todo: some day\n// Todo on ${here}: Not every time: some day\n${right}`,
    "wrong-under-asan.js": `// Todo under ASAN: some day\n${wrong}`,
    "right-under-asan.js": `// Todo under ASAN: some day\n${right}`,
  });
  const root = String(dir);
  const files = Object.keys(expected).map(name => join(root, name));
  const { stdout, exitCode } = await run(
    [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=4", "--no-erased", ...files],
    root,
    bunEnv,
  );
  const verdicts = Object.fromEntries(
    stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state !== "compiling")
      .map(({ file, state, stage, message }) => [
        file.slice(root.length + 1).replaceAll("\\", "/"),
        state === "pass" ? "pass" : `${state === "skip" ? "skip" : stage}: ${message}`,
      ]),
  );
  expect(verdicts).toEqual(expected);
  expect(exitCode).toBe(1);
}, 120_000);
