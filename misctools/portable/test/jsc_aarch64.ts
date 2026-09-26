// Everything that is asked of the aarch64 image of JavaScriptCore on a Linux machine, in one
// run. An x86-64 machine runs the image and its host under qemu-aarch64.
//
//   bun test/jsc_aarch64.ts [--runs 5] [--out <WORK>/out/aarch64/proof] [--only step,step]
//
// What it needs, from jsc/build-aarch64.ts, under WORK (the directory above this tree):
//   out/aarch64/jsc.img                   the image
//   out/aarch64/jsc.x18-allocatable.img   JSC_VARIANT=x18-allocatable, the negative control
//   out/aarch64/jsc.jit-permissions.img   JSC_VARIANT=jit-permissions (optional)
//   out/aarch64/host-linux                the test host (step small of jsc/build-aarch64.ts)
//
// Steps, each with its own directory of results and one line in summary.json:
//   static     test/check_aarch64.ts over the image: no instruction writes x18, and the rest
//   scenarios  the scenarios, direct and hosted (x18 holds the block of the host, which
//              checks it at every request and signal)
//   control    MUST FAIL: the image whose JIT may hand out x18, hosted. The step passes when
//              the host ended runs with exit code 96, and when the same image passes direct
//   hwcap0     hosted, the image is told that the processor has no feature of AT_HWCAP
//   winmem     hosted, the memory model of the Windows host
//   overlay    hosted, pages are discarded the way the macOS host does it
//   page16     hosted, pages of 16 KiB, which is macOS on Apple Silicon
//   jitwx      hosted, memory for code is writable or executable for a thread: the switches
//   permissions  the image that says itself when it writes code, under jitwx: what is said,
//              and the faults that are left
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const tree = resolve(dirname(import.meta.path), "..");
const work = resolve(tree, "..");
const option = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const runs = option("runs", "5");
const out = resolve(option("out", join(work, "out/aarch64/proof")));
const only = option("only", "").split(",").filter(Boolean);
const images = join(work, "out/aarch64");
const host = join(images, "host-linux");
mkdirSync(out, { recursive: true });

type Line = { step: string; passed: boolean; seconds: number; what: string; result: string };
const summary: Line[] = [];
function step(name: string, what: string, cmd: string[], result: string) {
  if (only.length && !only.includes(name)) return;
  const started = Date.now();
  const log = join(out, `${name}.log`);
  const r = Bun.spawnSync(cmd, { stdout: Bun.file(log), stderr: Bun.file(`${log}.err`) });
  const line = { step: name, passed: r.exitCode === 0, seconds: Math.round((Date.now() - started) / 1000), what, result };
  summary.push(line);
  console.log(`${name.padEnd(12)} ${line.passed ? "passed" : "FAILED"}   ${line.seconds} s   ${what}`);
  if (!line.passed) console.log(readFileSync(log, "utf8").split("\n").slice(-15).join("\n"));
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
}
const scenarios = (image: string, dir: string, modes: string, more: string[] = []) => [
  "bun", join(tree, "test/jsc_scenarios.ts"), "--runs", runs, "--image", join(images, image), "--host", host, "--out", join(out, dir, "scenarios.json"), "--modes", modes, ...more,
];

step("static", "no instruction of the image writes x18", ["bun", join(tree, "test/check_aarch64.ts"), "--image", join(images, "jsc.img"), "--out", join(out, "static.json")], join(out, "static.json"));
step("scenarios", `direct and hosted, ${runs} runs`, scenarios("jsc.img", "scenarios", "direct,hosted"), join(out, "scenarios/scenarios.json"));
if (existsSync(join(images, "jsc.x18-allocatable.img"))) {
  step("control", `must fail: the JIT may hand out x18, hosted, ${runs} runs`, scenarios("jsc.x18-allocatable.img", "control", "direct,hosted", ["--must-end-with", "96"]), join(out, "control/scenarios.json"));
}
for (const mode of ["hwcap0", "winmem", "overlay", "page16", "jitwx"]) step(mode, `hosted, ${mode}, ${runs} runs`, scenarios("jsc.img", mode, mode), join(out, mode, "scenarios.json"));
if (existsSync(join(images, "jsc.jit-permissions.img"))) {
  step("permissions", `the image that says when it writes code: hosted and jitwx, ${runs} runs`, scenarios("jsc.jit-permissions.img", "permissions", "direct,hosted,jitwx"), join(out, "permissions/scenarios.json"));
}
process.exit(summary.every(l => l.passed) ? 0 : 1);
