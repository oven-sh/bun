// The program of the compile benchmark: features that each bring handlers, a command and a method that registers them, and that meet in a list, in the
// routes of a router and in a map of commands. Functions that meet are called where they meet, with what is passed there. When they were handed whatever
// any function is handed that the compiler has lost sight of, a handler that reads a member of its request let the global object, Bun and process go
// whole: some 3,700 built-ins "escape, so any member may be used", the bundler, the transpiler and the debugger among what stays, 48 MB of every such
// executable. How many features meet must make no difference.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { generate } from "../../bench/compiler/generate";
import { run } from "./harness/run";
import { test } from "./supported";

test.each([2, 5, 40])(
  "%d features that meet let next to nothing of the host go",
  async features => {
    using dir = tempDir("features-that-meet", generate(features, "typed"));
    const { stderr } = await run(
      [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
      String(dir),
      {
        ...bunEnv,
        NO_COLOR: "1",
      },
    );
    expect(stderr).toContain("aot: trim: the compiler can see every API this program uses");
    expect(stderr.split("\n").filter(line => line.includes("escapes, so any member")).length).toBeLessThanOrEqual(16);
  },
  120_000,
);
