// Verify that a Bun binary doesn't use CPU instructions beyond its baseline target.
//
// Detects the platform and chooses the appropriate emulator:
//   Linux x64:    QEMU with Nehalem CPU (no AVX)
//   Linux arm64:  QEMU with Cortex-A53 (no LSE/SVE)
//   Windows x64:  Intel SDE with -nhm (no AVX)
//
// Usage:
//   bun scripts/verify-baseline.ts --binary ./bun --emulator /usr/bin/qemu-x86_64
//   bun scripts/verify-baseline.ts --binary ./bun.exe --emulator ./sde.exe

import { readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const { parseArgs } = require("node:util");

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    binary: { type: "string" },
    emulator: { type: "string" },
  },
  strict: true,
});

const binary = resolve(values.binary!);

function resolveEmulator(name: string): string {
  const found = Bun.which(name);
  if (found) return found;
  // Try without -static suffix (e.g. qemu-aarch64 instead of qemu-aarch64-static)
  if (name.endsWith("-static")) {
    const fallback = Bun.which(name.slice(0, -"-static".length));
    if (fallback) return fallback;
  }
  // Last resort: resolve as a relative path (e.g. sde-external/sde.exe)
  return resolve(name);
}

const emulatorPath = resolveEmulator(values.emulator!);

const scriptDir = dirname(import.meta.path);
const repoRoot = resolve(scriptDir, "..");
const fixturesDir = join(repoRoot, "test", "js", "bun", "jsc-stress", "fixtures");
const wasmFixturesDir = join(fixturesDir, "wasm");
const preloadPath = join(repoRoot, "test", "js", "bun", "jsc-stress", "preload.js");

// Platform detection
const isWindows = process.platform === "win32";
const isAarch64 = process.arch === "arm64";

// SDE outputs this when a chip-check violation occurs
const SDE_VIOLATION_PATTERN = /SDE-ERROR:.*not valid for specified chip/i;

// Configure emulator based on platform
const config = isWindows
  ? {
      runnerCmd: [emulatorPath, "-nhm", "--"],
      cpuDesc: "Nehalem (SSE4.2, no AVX/AVX2/AVX512)",
      // SDE must run from its own directory for Pin DLL resolution
      cwd: dirname(emulatorPath),
    }
  : isAarch64
    ? {
        runnerCmd: [emulatorPath, "-cpu", "cortex-a53"],
        cpuDesc: "Cortex-A53 (ARMv8.0-A+CRC, no LSE/SVE)",
        cwd: undefined,
      }
    : {
        runnerCmd: [emulatorPath, "-cpu", "Nehalem"],
        cpuDesc: "Nehalem (SSE4.2, no AVX/AVX2/AVX512)",
        cwd: undefined,
      };

function isInstructionViolation(exitCode: number, output: string): boolean {
  if (isWindows) return SDE_VIOLATION_PATTERN.test(output);
  return exitCode === 132; // SIGILL = 128 + signal 4
}

console.log(`--- Verifying ${basename(binary)} on ${config.cpuDesc}`);
console.log(`    Binary:   ${binary}`);
console.log(`    Emulator: ${config.runnerCmd.join(" ")}`);
console.log();

let instructionFailures = 0;
let otherFailures = 0;
let passed = 0;

async function runTest(label: string, binaryArgs: string[], cwd?: string): Promise<boolean> {
  console.log(`+++ ${label}`);

  const start = performance.now();
  const proc = Bun.spawn([...config.runnerCmd, binary, ...binaryArgs], {
    cwd: cwd ?? config.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  const output = stdout + "\n" + stderr;

  if (exitCode === 0) {
    if (stdout.trim()) console.log(stdout.trim());
    console.log(`    PASS (${elapsed}s)`);
    passed++;
    return true;
  }

  if (isInstructionViolation(exitCode, output)) {
    if (output.trim()) console.log(output.trim());
    console.log();
    console.log(`    FAIL: CPU instruction violation detected (${elapsed}s)`);
    if (isAarch64) {
      console.log("    The aarch64 build targets Cortex-A53 (ARMv8.0-A+CRC).");
      console.log("    LSE atomics, SVE, and dotprod instructions are not allowed.");
    } else {
      console.log("    The baseline x64 build targets Nehalem (SSE4.2).");
      console.log("    AVX, AVX2, and AVX512 instructions are not allowed.");
    }
    instructionFailures++;
  } else {
    if (output.trim()) console.log(output.trim());
    console.log(`    WARN: exit code ${exitCode} (${elapsed}s, not a CPU instruction issue)`);
    otherFailures++;
  }
  return false;
}

// Phase 1: Basic binary verification
console.log("--- Basic binary verification");
const versionOk = await runTest("bun --version", ["--version"]);
if (!versionOk && instructionFailures > 0) {
  console.error("Binary immediately fails on baseline CPU. Aborting.");
  process.exit(1);
}
await runTest("bun -e eval", ["-e", "console.log(JSON.stringify({ok:1+1}))"]);

// Phase 2: JIT stress fixtures
const jsFixtures = readdirSync(fixturesDir)
  .filter(f => f.endsWith(".js"))
  .sort();
console.log();
console.log(`--- JS fixtures (DFG/FTL) — ${jsFixtures.length} tests`);
for (let i = 0; i < jsFixtures.length; i++) {
  const fixture = jsFixtures[i];
  await runTest(`[${i + 1}/${jsFixtures.length}] ${fixture}`, ["--preload", preloadPath, join(fixturesDir, fixture)]);
}

const wasmFixtures = readdirSync(wasmFixturesDir)
  .filter(f => f.endsWith(".js"))
  .sort();
console.log();
console.log(`--- Wasm fixtures (BBQ/OMG) — ${wasmFixtures.length} tests`);
for (let i = 0; i < wasmFixtures.length; i++) {
  const fixture = wasmFixtures[i];
  await runTest(
    `[${i + 1}/${wasmFixtures.length}] ${fixture}`,
    ["--preload", preloadPath, join(wasmFixturesDir, fixture)],
    wasmFixturesDir,
  );
}

// Summary
console.log();
console.log("--- Summary");
console.log(`    Passed: ${passed}`);
console.log(`    Instruction failures: ${instructionFailures}`);
console.log(`    Other failures: ${otherFailures} (warnings, not CPU instruction issues)`);
console.log();

if (instructionFailures > 0) {
  console.error("    FAILED: Code uses unsupported CPU instructions.");
  process.exit(1);
}

if (otherFailures > 0) {
  console.log("    Some tests failed for reasons unrelated to CPU instructions.");
}

console.log(`    All baseline verification passed on ${config.cpuDesc}.`);
