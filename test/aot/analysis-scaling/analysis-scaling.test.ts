import { expect } from "bun:test";
import { isASAN, isDebug, isMusl, tempDir } from "harness";
import { describe, test } from "../supported";
import { measureCheck } from "./measure-check";
import { shapes, type Shape } from "./shapes";

const allowedNoise = { instructions: 30_000_000, peakBytes: 64 * 1024 * 1024 };
// The allowances were taken with glibc. A Bun that is linked with musl runs a quarter more instructions for the same work.
const instructionsOfThisLibc = isMusl ? 4 / 3 : 1;
const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions and bytes"
    : process.platform !== "linux" && process.platform !== "darwin"
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/analysis-scaling: ${skipped}`);

describe.skipIf(!!skipped)("bun check --aot cost per item", () => {
  const costsNoMoreThanAllowed = async (shape: Shape) => {
    const measure = async (count: number) => {
      using folder = tempDir("aot-analysis-scaling", shape.write(count));
      return await measureCheck(String(folder), ["./main.ts"]);
    };
    const none = await measure(0);
    for (const count of shape.sizes) {
      const cost = await measure(count);
      const added = {
        instructions:
          cost.instructions === undefined || none.instructions === undefined
            ? 0
            : cost.instructions - none.instructions,
        peakBytes: cost.peakBytes - none.peakBytes,
      };
      const allowed = {
        instructions: (allowedNoise.instructions + count * shape.instructionsPerItem) * instructionsOfThisLibc,
        peakBytes: allowedNoise.peakBytes + count * shape.bytesPerItem,
      };
      const excessive = (Object.keys(added) as (keyof typeof added)[])
        .filter(name => added[name] > allowed[name])
        .map(name => `${count} ${shape.counted} add ${added[name]} ${name}; allowed: ${allowed[name]}`);
      expect(excessive).toEqual([]);
    }
  };
  test.concurrent.each(shapes)("$name", costsNoMoreThanAllowed, 600_000);
});
