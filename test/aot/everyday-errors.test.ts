// The message and the stack of an error read the same in an executable and under `bun run`: what the message quotes, and the names, the lines and the columns of the frames.
// ./everyday-errors.fixture.mjs fails in about three hundred everyday ways, one after the other. The paths alone differ: an executable prints them relative to the folder of the build.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };

test.skipIf(!!unsupported)("everyday errors have the message and the stack that they have under bun run", () =>
  slot(async () => {
    using dir = tempDir("aot-everyday-errors", {
      "main.mjs": readFileSync(join(import.meta.dir, "everyday-errors.fixture.mjs"), "utf8"),
    });
    const folder = String(dir);
    // A build with assertions records positions inside built-in functions, so plain Bun gives `from (native:17:36)` there and `from (native:1:11)` in a release build. An executable gives `from (native:1:11)` in both.
    const linesOf = (stdout: string) =>
      stdout
        .replaceAll(folder.replaceAll("\\", "/") + "/", "./")
        .replaceAll(folder + "\\", "./")
        .replace(/\(native:\d+:\d+\)/g, "(native)")
        .split("\n");
    const build = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      ...withoutDebugInformation,
      "./main.mjs",
      "--outfile",
      "built",
    ];
    const built = await spawned(build, folder, env);
    expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const plain = await spawned([bunExe(), "run", "--no-install", "./main.mjs"], folder, env);
    const compiled = await spawned([join(folder, isWindows ? "built.exe" : "built")], folder, env);
    expect(linesOf(compiled.stdout)).toEqual(linesOf(plain.stdout));
    expect(compiled).toMatchObject({ stderr: plain.stderr, exitCode: plain.exitCode });
  }),
);
