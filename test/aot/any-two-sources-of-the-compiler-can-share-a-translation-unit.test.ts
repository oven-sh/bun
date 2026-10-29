// The engine compiles aot/ as unified sources: a bundle includes several sources one after the other, and a source that is added
// or moved shifts every bundle behind it. Tools/Scripts/aot/check-unified-sources.py reads the text of all of them and names
// whatever two of them could not declare side by side.
import { expect, test } from "bun:test";
import { bunEnv } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/any-two-sources-of-the-compiler-can-share-a-translation-unit.test.ts");

const script = sources && join(sources, "..", "..", "..", "Tools", "Scripts", "aot", "check-unified-sources.py");
// $AOT_ENGINE_DIRECTORY may name a copy of aot/ alone, with no Tools beside it. A checkout has both.
const isMissing = !script || !existsSync(script);
if (sources && isMissing) {
  if (process.env.AOT_REQUIRE_ENGINE_SOURCES && !process.env.AOT_ENGINE_DIRECTORY)
    throw new Error(`Missing ${script}, which AOT_REQUIRE_ENGINE_SOURCES asks for`);
  console.error(
    `SKIPPED: test/aot/any-two-sources-of-the-compiler-can-share-a-translation-unit.test.ts: there is no ${script}`,
  );
}

test.skipIf(isMissing)(
  "no two sources declare one name for themselves",
  async () => {
    await using checker = Bun.spawn(["python3", script!], { env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      checker.stdout.text(),
      checker.stderr.text(),
      checker.exited,
    ]);
    expect({ problems: stdout.split("\n").filter(line => line.startsWith("  ")), stderr, exitCode }).toEqual({
      problems: [],
      stderr: "",
      exitCode: 0,
    });
  },
  120_000,
);
