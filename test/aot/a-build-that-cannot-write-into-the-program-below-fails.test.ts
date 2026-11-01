// The build of a layer lays the headers of its texts into the lowest program of the run, through the handle that the run gave it. Where that write
// was refused, by a full disk or a handle that cannot be written, the build dropped the error and said that it had succeeded: the program below then
// read texts of the layer through headers that were never laid.
import { expect } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "p" }`,
  "helper.ts": `export const words = () => ["a text of the layer", "another text of the layer"].join(", ");\n`,
  "a.test.ts": `import { expect, test } from "bun:test";\nimport { words } from "./helper.ts";\ntest("a", () => { expect(words()).toContain("another"); });\n`,
};
const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };

test.skipIf(!isPosix)(
  "the build of a layer",
  async () => {
    using dir = tempDir("aot-a-build-that-cannot-write-below", files);
    const at = (name: string) => join(String(dir), name);
    const build = async (graph: string, part: string, below: number[]) => {
      writeFileSync(at(graph), at("a.test.ts") + "\0");
      const descriptor = openSync(at(graph), "r+");
      try {
        await using builder = Bun.spawn({
          cmd: [bunExe(), "test", "--aot", "--isolate", `--aot-build-test-part=${part}`],
          cwd: String(dir),
          env,
          stdio: ["ignore", "pipe", "pipe", descriptor, ...below],
        });
        const [stderr, exitCode] = await Promise.all([builder.stderr.text(), builder.exited]);
        return { errors: stderr.split("\n").filter(line => line.startsWith("error: ")), exitCode };
      } finally {
        closeSync(descriptor);
      }
    };
    const buildAbove = async (flags: string) => {
      const packages = openSync(at("packages"), flags);
      try {
        return await build("shared", "3,shared,below:4", [packages]);
      } finally {
        closeSync(packages);
      }
    };
    expect(await build("packages", "3,shared,packages", [])).toEqual({ errors: [], exitCode: 0 });
    expect(await buildAbove("r")).toEqual({
      errors: [
        "error: the build failed",
        `error: the headers of this program's texts could not be written into the program below it, ${at("packages")}: EBADF`,
        "error: failed to create executable: EBADF",
      ],
      exitCode: 1,
    });
    expect(await buildAbove("r+")).toEqual({ errors: [], exitCode: 0 });
  },
  120_000,
);
