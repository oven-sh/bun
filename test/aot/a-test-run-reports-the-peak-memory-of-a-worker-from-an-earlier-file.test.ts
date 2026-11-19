import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, tempDir } from "harness";
import { reads } from "./harness/reads";
import { run } from "./harness/run";
import { test } from "./supported";

const spikeMB = 256;

const spike = `
import { expect, test } from "bun:test";
test("holds ${spikeMB} MB for a moment", async () => {
  let bytes = new Uint8Array(${spikeMB} * 1024 * 1024).fill(1);
  expect(bytes.at(-1)).toBe(1);
  const held = process.memoryUsage.rss();
  bytes = null;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && process.memoryUsage.rss() > held - ${spikeMB / 2} * 1024 * 1024) {
    Bun.gc(true);
    await Bun.sleep(20);
  }
}, 30_000);
`;

const printsKernelPeak = `
import { test } from "bun:test";
test("prints the peak that the kernel remembers", () => {
  console.log("kernel peak KB", process.resourceUsage().maxRSS);
});
`;

async function runOnOneWorker(lastFile: string, ...flags: string[]) {
  using dir = tempDir("aot-worker-peak-memory", {
    "1-spike.test.js": spike,
    "2-after.test.js": printsKernelPeak,
    "3-last.test.js": `import { test } from "bun:test";\ntest("last", () => {${lastFile}});\n`,
  });
  // The second worker starts only after the delay, so the first one runs every file, the spike first.
  const cmd = [bunExe(), "test", ...flags, "--isolate", "--parallel=2", "--parallel-delay=600000"];
  const { stdout, stderr, exitCode } = await run(cmd, String(dir), { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" });
  const output = stdout + stderr;
  const numberIn = (pattern: RegExp) => Number(output.match(pattern)?.[1]);
  return {
    exitCode,
    workers: [...output.matchAll(/^AOT account \| worker \| files (\d+) \|.* \| peak (\d+) MB$/gm)].map(match => ({
      files: Number(match[1]),
      peakMB: Number(match[2]),
    })),
    buildPeakMB: Math.max(...output.matchAll(/^AOT phase times: .* \| peak (\d+) MB/gm).map(match => Number(match[1]))),
    coordinatorPeakMB: numberIn(/^AOT account \| coordinator \|.* \| peak (\d+) MB$/m),
    largestWorkerPeakMB: numberIn(/^AOT test run \| largest worker or child of a worker \| peak (\d+) MB$/m),
    kernelPeakMB: numberIn(/^kernel peak KB (\d+)$/m) / 1024,
  };
}

test("a worker that ends normally reports a peak from its first file", async () => {
  const result = await runOnOneWorker("", "--aot");
  expect(result.exitCode).toBe(0);
  expect(result.largestWorkerPeakMB).toBeGreaterThanOrEqual(spikeMB);
  if (!isWindows) {
    expect(result.workers.map(worker => worker.files)).toEqual([3]);
    expect(result.workers[0].peakMB).toBeGreaterThanOrEqual(spikeMB);
  }
  // A sanitizer build does not return the memory.
  if (isLinux && !isASAN) expect(result.largestWorkerPeakMB - result.kernelPeakMB).toBeGreaterThan(spikeMB / 4);
});

test("the run reports the peak of a worker that exits in a later file", async () => {
  const result = await runOnOneWorker("process.exit(7);", "--aot");
  expect(result.exitCode).toBe(1);
  expect(result.largestWorkerPeakMB).toBeGreaterThanOrEqual(spikeMB);
  // That worker prints no line of its own. The one that replaces it does.
  for (const worker of result.workers) expect(result.largestWorkerPeakMB - worker.peakMB).toBeGreaterThan(spikeMB / 2);
});

test("a run without --aot reports the peak of a worker that has printed its own", async () => {
  const result = await runOnOneWorker("");
  expect(result.exitCode).toBe(0);
  expect(result.largestWorkerPeakMB).toBeGreaterThanOrEqual(spikeMB);
  if (!isWindows) expect(result.workers[0].peakMB).toBeGreaterThanOrEqual(spikeMB);
});

test("a process does not report the peak of the process that started it", async () => {
  const startedBySmall = await runOnOneWorker("", "--aot");
  const held = new Uint8Array(2 * spikeMB * 1024 * 1024).fill(1);
  const startedByLarge = await runOnOneWorker("", "--aot");
  expect(held.at(-1)).toBe(1);
  expect(startedByLarge.exitCode).toBe(0);
  const apart = Math.abs(startedByLarge.buildPeakMB - startedBySmall.buildPeakMB);
  reads("the peak of the build of a test run by who starts it", apart, spikeMB / 2, "MB apart");
  expect(Math.abs(startedByLarge.buildPeakMB - startedBySmall.buildPeakMB)).toBeLessThan(spikeMB / 2);
  if (!isWindows)
    expect(Math.abs(startedByLarge.coordinatorPeakMB - startedBySmall.coordinatorPeakMB)).toBeLessThan(spikeMB / 2);
});
