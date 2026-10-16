// Verify that a Bun binary doesn't use CPU instructions beyond its baseline target.
//
// Detects the platform and chooses the appropriate emulator:
//   Linux x64:    QEMU with Nehalem CPU (no AVX)
//   Linux arm64:  QEMU with Cortex-A53 (no LSE/SVE)
//   Windows x64:  Intel SDE with -nhm (no AVX)
//
// Usage:
//   bun scripts/verify-baseline.ts --binary ./bun --arch x64 --emulator /usr/bin/qemu-x86_64
//   bun scripts/verify-baseline.ts --binary ./bun.exe --arch x64 --emulator ./sde.exe

import { readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { markBuildkiteStepReported } from "./buildkite.ts";

const { parseArgs } = require("node:util");

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    binary: { type: "string" },
    // Target arch of --binary ("x64" | "aarch64"). The host may differ (e.g.
    // verifying an x64 build from an arm64 CI host), so process.arch is only a
    // fallback for local dev.
    arch: { type: "string" },
    emulator: { type: "string" },
    "jit-stress": { type: "boolean", default: false },
    "skip-emulation": { type: "boolean", default: false },
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
  // Last resort: resolve as a path (absolute paths like C:\intel-sde\sde.exe
  // pass through unchanged, relative paths resolve against cwd)
  return resolve(name);
}

const emulatorPath = resolveEmulator(values.emulator!);

const scriptDir = dirname(import.meta.path);
const repoRoot = resolve(scriptDir, "..");
const fixturesDir = join(repoRoot, "test", "js", "bun", "jsc-stress", "fixtures");
const wasmFixturesDir = join(fixturesDir, "wasm");
const preloadPath = join(repoRoot, "test", "js", "bun", "jsc-stress", "preload.js");

// Host OS (getVerifyBaselineHost() guarantees host OS == target OS here).
const isWindows = process.platform === "win32";
// Target arch (host arch may differ; --arch is explicit).
const targetArch = values.arch ?? (process.arch === "arm64" ? "aarch64" : "x64");
if (targetArch !== "x64" && targetArch !== "aarch64") {
  throw new Error(`--arch must be "x64" or "aarch64", got: ${targetArch}`);
}
const isAarch64 = targetArch === "aarch64";

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

function isInstructionViolation(signalCode: NodeJS.Signals | number | null, output: string): boolean {
  if (isWindows) return SDE_VIOLATION_PATTERN.test(output);
  // qemu-user re-raises the guest's fatal signal on the host, so the process is WIFSIGNALED:
  // `proc.exitCode` is null and only `proc.signalCode` carries the verdict.
  return signalCode === "SIGILL";
}

console.log(`--- Verifying ${basename(binary)} on ${config.cpuDesc}`);
console.log(`    Binary:   ${binary}`);
console.log(`    Emulator: ${config.runnerCmd.join(" ")}`);
console.log();

let instructionFailures = 0;
let otherFailures = 0;
let passed = 0;
const failedTests: string[] = [];

interface RunTestOptions {
  cwd?: string;
  /** Tee output live to the console while still capturing it for analysis */
  live?: boolean;
}

/** Read a stream, write each chunk to a writable, and return the full text. */
async function teeStream(stream: ReadableStream<Uint8Array>, output: NodeJS.WriteStream): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
    output.write(chunk);
  }
  return Buffer.concat(chunks).toString();
}

// ---- TEMPORARY MEASUREMENT: symbolize the trace of a crash report printed by the last run ----
let lastOutput = "";
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function readVlq(text: string, at: number): [number, number] {
  let value = 0;
  let scale = 1;
  for (;;) {
    const digit = base64Alphabet.indexOf(text[at++]);
    if (digit < 0) throw new Error(`bad VLQ digit at ${at - 1}`);
    value += (digit & 31) * scale;
    scale *= 32;
    if (!(digit & 32)) break;
  }
  const negative = value % 2 === 1;
  value = Math.floor(value / 2);
  return [negative ? -value : value, at];
}
async function symbolizeCrash() {
  const match = /https:\/\/bun\.report\/[^/\s]+\/(\S+)/.exec(lastOutput);
  if (!match) {
    console.log("    (no crash report in the output of this run)");
    return;
  }
  try {
    const trace = match[1];
    let at = 10; // platform, command, version, 7 hex of the commit
    [, at] = readVlq(trace, at);
    [, at] = readVlq(trace, at);
    const frames: { module: string; address: number }[] = [];
    for (;;) {
      if (trace[at] === "_") {
        frames.push({ module: "?", address: 0 });
        at++;
        continue;
      }
      let value: number;
      [value, at] = readVlq(trace, at);
      if (value === 0) break;
      if (value === 1) {
        let length: number;
        [length, at] = readVlq(trace, at);
        const module = trace.slice(at, at + length);
        at += length;
        let address: number;
        [address, at] = readVlq(trace, at);
        frames.push({ module, address });
      } else {
        frames.push({ module: "bun", address: value });
      }
    }
    console.log(`+++ crash trace of the run above (${frames.length} frames, reason ${trace.slice(at)})`);
    frames.forEach((frame, index) => console.log(`    #${index} ${frame.module} 0x${frame.address.toString(16)}`));
    const pdb = binary.replace(/\.exe$/i, ".pdb");
    const symbolizer = Bun.which("pdb-addr2line");
    console.log(`    pdb: ${pdb} (exists: ${await Bun.file(pdb).exists()}), pdb-addr2line: ${symbolizer}`);
    console.log(`    files next to the binary: ${readdirSync(dirname(binary)).join(", ")}`);
    if (!isWindows || !symbolizer) return;
    const addresses = frames.filter(f => f.module === "bun").map(f => `0x${f.address.toString(16).toUpperCase()}`);
    for (const flags of [["-a", "-f", "-i", "-p"], []]) {
      const result = Bun.spawnSync([symbolizer, "--exe", pdb, ...flags, ...addresses], {
        stdout: "pipe",
        stderr: "pipe",
      });
      console.log(`    pdb-addr2line ${flags.join(" ")} exit ${result.exitCode}`);
      console.log(result.stdout.toString());
      console.log(result.stderr.toString());
      if (result.exitCode === 0) break;
    }
  } catch (error) {
    console.log("    failed to decode the crash trace:", error);
  }
}
// ---- END TEMPORARY MEASUREMENT ----

async function runTest(label: string, binaryArgs: string[], options?: RunTestOptions): Promise<boolean> {
  console.log(`+++ ${label}`);

  const start = performance.now();
  const live = options?.live ?? false;
  const proc = Bun.spawn([...config.runnerCmd, binary, ...binaryArgs], {
    // config.cwd takes priority — SDE on Windows must run from its own directory for Pin DLL resolution
    cwd: config.cwd ?? options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let stdout: string;
  let stderr: string;
  if (live) {
    [stdout, stderr] = await Promise.all([
      teeStream(proc.stdout as ReadableStream<Uint8Array>, process.stdout),
      teeStream(proc.stderr as ReadableStream<Uint8Array>, process.stderr),
      proc.exited,
    ]);
  } else {
    [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
  }

  const exitCode = proc.exitCode;
  const signalCode = proc.signalCode;
  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  const output = stdout + "\n" + stderr;
  lastOutput = output;

  if (exitCode === 0) {
    if (!live && stdout.trim()) console.log(stdout.trim());
    console.log(`    PASS (${elapsed}s)`);
    passed++;
    return true;
  }

  if (isInstructionViolation(signalCode, output)) {
    if (!live && output.trim()) console.log(output.trim());
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
    failedTests.push(label);
  } else {
    if (!live && output.trim()) console.log(output.trim());
    const how = exitCode === null ? `signal ${signalCode}` : `exit code ${exitCode}`;
    console.log(`    FAIL: ${how} (${elapsed}s, not a CPU instruction issue)`);
    otherFailures++;
    failedTests.push(label);
  }
  return false;
}

// Phase 0: Static instruction scan (no emulation — disassembles the binary).
// Catches instructions in code paths the emulator test below never executes.
// Soft-skipped if the checker isn't built (dev without cargo).
const staticCheckerExe = isWindows ? "verify-baseline-static.exe" : "verify-baseline-static";
const staticChecker = join(scriptDir, "verify-baseline-static", "target", "release", staticCheckerExe);
const staticAllowlistName = isWindows
  ? "allowlist-x64-windows.txt"
  : isAarch64
    ? "allowlist-aarch64.txt"
    : "allowlist-x64.txt";
const staticAllowlist = join(scriptDir, "verify-baseline-static", staticAllowlistName);
let staticViolations = "";

if (await Bun.file(staticChecker).exists()) {
  console.log("+++ Static instruction scan");
  const start = performance.now();
  const proc = Bun.spawn([staticChecker, "--binary", binary, "--allowlist", staticAllowlist], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(stdout);

  if (code === 0) {
    console.log(`    PASS (${elapsed}s)`);
    passed++;
  } else if (code === 1) {
    // Pull just the VIOLATIONS block for the annotation — full stdout is in the log.
    const m = stdout.match(/^VIOLATIONS[^\n]*\n([\s\S]*?)\n(?:ALLOWLISTED|STALE|SUMMARY)/m);
    staticViolations = m ? m[1].trim() : stdout;
    console.log(`    FAIL: static scan found post-baseline instructions outside the allowlist (${elapsed}s)`);
    instructionFailures++;
    failedTests.push("Static instruction scan");
  } else {
    console.log(`    FAIL: checker exited ${code} (${elapsed}s, tool error)`);
    otherFailures++;
    failedTests.push("Static instruction scan (tool error)");
  }
  console.log();
} else {
  console.log("--- Skipping static instruction scan (not built)");
  console.log("    cargo build --release --manifest-path scripts/verify-baseline-static/Cargo.toml");
  console.log();
}

// Phase 1/2: emulated runs. --skip-emulation (CI sets this for Android, whose
// binary needs /system/bin/linker64 and has no sysroot on the build host)
// leaves only the static scan.
if (values["skip-emulation"]) {
  console.log("--- Skipping emulated runs (--skip-emulation)");
} else {
  // Phase 1: SIMD code path verification
  const simdTestPath = join(repoRoot, "test", "js", "bun", "jsc-stress", "fixtures", "simd-baseline.test.ts");
  await runTest("SIMD baseline tests", ["test", "--timeout=90000", simdTestPath], { live: true });

  // ---- TEMPORARY MEASUREMENT ----
  await symbolizeCrash();
  const probePath = join(fixturesDir, "simd-baseline-probe.test.ts");
  await runTest("probe: phases #1", ["test", "--timeout=300000", probePath], { live: true });
  await symbolizeCrash();
  await runTest("probe: SIMD baseline tests #2", ["test", "--timeout=90000", simdTestPath], { live: true });
  await runTest("probe: phases #2", ["test", "--timeout=300000", probePath], { live: true });
  await runTest("probe: bun -e", ["-e", "console.log(1)"], { live: true });
  await symbolizeCrash();
  // ---- END TEMPORARY MEASUREMENT ----
}

// Phase 2: JIT stress fixtures (only with --jit-stress, e.g. on WebKit changes)
if (values["skip-emulation"]) {
  // already reported the skip above
} else if (values["jit-stress"]) {
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
      { cwd: wasmFixturesDir },
    );
  }
} else {
  console.log();
  console.log("--- Skipping JIT stress fixtures (pass --jit-stress to enable)");
}

// Summary
console.log();
console.log("--- Summary");
console.log(`    Passed: ${passed}`);
console.log(`    Instruction failures: ${instructionFailures}`);
console.log(`    Other failures: ${otherFailures} (not CPU instruction issues)`);
console.log();

const platform = isWindows
  ? isAarch64
    ? "Windows aarch64"
    : "Windows x64"
  : isAarch64
    ? "Linux aarch64"
    : "Linux x64";

function annotate(html: string) {
  Bun.spawnSync(["buildkite-agent", "annotate", "--append", "--style", "error", "--context", "verify-baseline"], {
    stdin: new Blob([html]),
  });
  // Suppress the generic fallback in .buildkite/hooks/pre-exit; this script
  // owns its failure annotation.
  markBuildkiteStepReported();
}

if (instructionFailures > 0) {
  console.error("    FAILED: Code uses unsupported CPU instructions.");

  const parts = [
    `<details open>`,
    `<summary>❌ CPU instruction violation on <b>${platform}</b> — ${instructionFailures} check(s) failed</summary>`,
    `<p>The baseline build contains instructions not available on <code>${config.cpuDesc}</code>.</p>`,
    `<ul>${failedTests.map(t => `<li><code>${t}</code></li>`).join("")}</ul>`,
  ];
  if (staticViolations) {
    // Cap the inline block so a -march= leak (thousands of symbols) doesn't
    // produce a multi-MB annotation. Full output is in the step log.
    const lines = staticViolations.split("\n");
    const shown =
      lines.length > 80 ? [...lines.slice(0, 80), `... ${lines.length - 80} more lines (see step log)`] : lines;
    parts.push(
      `<h4>Static scan violations</h4>`,
      `<pre><code>${shown.join("\n").replace(/</g, "&lt;")}</code></pre>`,
      `<p><b>If these are runtime-dispatched behind a CPUID gate:</b> add each symbol to`,
      `<code>scripts/verify-baseline-static/${staticAllowlistName}</code> with a comment pointing at the gate.`,
      `Feature ceilings (the <code>[FEAT, ...]</code> bracket) should list what the gate checks.</p>`,
      `<p><b>If there's no gate:</b> this is a real bug — a <code>-march</code> leaked into a subbuild.`,
      `Find the translation unit and fix its compile flags.</p>`,
    );
  }
  parts.push(`</details>`);
  annotate(parts.join("\n"));

  process.exit(1);
}

if (otherFailures > 0) {
  console.error(`    FAILED: ${otherFailures} check(s) failed under emulation on ${config.cpuDesc}.`);

  annotate(
    [
      `<details open>`,
      `<summary>❌ Baseline verification failed on <b>${platform}</b> — ${otherFailures} check(s)</summary>`,
      `<p>The baseline build crashed or failed tests under <code>${config.cpuDesc}</code> emulation ` +
        `(not an unsupported-instruction fault). See the step log for the crash output.</p>`,
      `<ul>${failedTests.map(t => `<li><code>${t}</code></li>`).join("")}</ul>`,
      `</details>`,
    ].join("\n"),
  );

  process.exit(1);
}

console.log(`    All baseline verification passed on ${config.cpuDesc}.`);
