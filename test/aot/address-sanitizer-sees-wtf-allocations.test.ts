import { expect } from "bun:test";
import { test } from "./harness/declare";
import { bunEnv, bunExe, isASAN } from "harness";
import { run } from "./harness/run";

test.skipIf(!isASAN)(
  "AddressSanitizer reports a read of a freed WTF::StringImpl in what these tests start",
  async () => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "-e", `console.log("read", require("bun:internal-for-testing").readFreedStringUnderASAN());`],
      undefined,
      bunEnv,
    );
    expect(stderr).toContain("AddressSanitizer: heap-use-after-free");
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  },
);
