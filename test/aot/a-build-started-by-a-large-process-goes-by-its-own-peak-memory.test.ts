import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { reads } from "./harness/reads";
import { run } from "./harness/run";
import { test } from "./supported";

const heldMB = 768;

async function peakThatABuildComparesItsMemoryWith() {
  using dir = tempDir("aot-build-own-peak", { "hello.js": `console.log("hello");\n` });
  const cmd = [bunExe(), "build", "--compile", "--aot", "hello.js", "--outfile", "hello"];
  const { stderr, exitCode } = await run(cmd, String(dir), { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" });
  expect(exitCode).toBe(0);
  return Number(stderr.match(/^AOT free blocks \| most resident seen (\d+) MB \|/m)?.[1]);
}

// A sanitizer build has another allocator, which nothing watches.
test.skipIf(isASAN)("a build does not take the peak of the process that started it for its own", async () => {
  const startedBySmall = await peakThatABuildComparesItsMemoryWith();
  const held = new Uint8Array(heldMB * 1024 * 1024).fill(1);
  const startedByLarge = await peakThatABuildComparesItsMemoryWith();
  expect(held.at(-1)).toBe(1);
  expect(startedBySmall).not.toBeNaN();
  reads("the peak of a build by who starts it", Math.abs(startedByLarge - startedBySmall), heldMB / 4, "MB apart");
  expect(Math.abs(startedByLarge - startedBySmall)).toBeLessThan(heldMB / 4);
});
