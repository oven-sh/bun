// A build prints TS100098 for a read of a data file that a computed import found only where the executable ends up without the file, and
// `bun check --aot` writes no executable: it prints no such warning. A `bun-ignore` comment that the build needs there isn't stale.
// What a build prints is held by the programs of parallel/unembedded-file-reads/silenced-pattern-embedded-file*.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

test("bun check --aot calls a comment stale only where no build has a warning for it", async () => {
  using dir = tempDir("bun-check-needed-comment", {
    "main.mjs": `import fs from "node:fs";
// bun-ignore TS100064
import.meta.require("./info/" + process.argv[2] + ".json");
// bun-ignore TS100098
fs.readFileSync(new URL("./info/data.json", import.meta.url));
// bun-ignore TS100165
fs.readFileSync(new URL("./info/data.json", import.meta.url));
`,
    "info/data.json": `{}`,
    "info/note.txt": `a note`,
  });
  // One thread: a debug build of Bun stops at random in the engine's parallel link.
  const cmd = [bunExe(), "check", "--aot", "--no-pretty", "--threads=1", "main.mjs"];
  const { stdout, stderr, exitCode } = await run(cmd, String(dir));
  expect({ said: (stdout + stderr).split("\n").filter(line => line.includes("TS100")), exitCode }).toEqual({
    said: [
      "main.mjs(6,4): warning TS100073: This comment silences nothing: the build reports no TS100165 on the line that it applies to",
    ],
    exitCode: 0,
  });
});
