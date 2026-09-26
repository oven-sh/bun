// Which functions of the POSIX host have run? Builds it with the coverage of clang, runs
// the test images and the scenarios of the jsc image with it, and prints the functions
// that no run entered.
//
//   bun test/coverage.ts [--out <dir>] [--runs 2]
//
// host_posix.c runs as the Linux test host (as it is, with BUN_HOST_TEST=winmem and with
// BUN_HOST_TEST=overlay). Its macOS branches are not compiled here at all: nothing of them
// is in the result, and nothing of them has run. host/memory.h is part of the result, it
// runs with BUN_HOST_TEST=winmem. host_win.c is not part of this: it is built and run on
// Windows only.
// Needs: build.sh x86_64 (the test images), jsc/build.ts (the image).
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const tree = resolve(dirname(import.meta.path), "..");
const work = resolve(tree, "..");
const option = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const out = resolve(option("out", join(work, "out/coverage")));
const runs = option("runs", "2");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const images = join(tree, "out/x86_64");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// output: "pipe" collects it, "inherit" shows it.
function run(cmd: string[], env: Record<string, string | undefined> = process.env, output: "pipe" | "inherit" = "pipe") {
  const r = Bun.spawnSync(cmd, { env, stdin: "ignore", stdout: output, stderr: output, cwd: out, timeout: 1_800_000 });
  return { code: r.exitCode, text: output === "pipe" ? r.stdout.toString() + r.stderr.toString() : "" };
}
function must(cmd: string[]) {
  const r = run(cmd);
  if (r.code !== 0) throw new Error(`${cmd.join(" ")}\n${r.text}`);
  return r.text;
}
const flags = ["-O1", "-fprofile-instr-generate", "-fcoverage-mapping"];
const hostLinux = join(out, "host-linux");
must([`${llvm}/clang`, ...flags, "-o", hostLinux, join(tree, "host/host_posix.c"), join(tree, "test/coverage_hook.c"), "-lpthread"]);

const small = [
  { image: "threads.img", args: [join(out, "probe.tmp")] },
  { image: "linux_paths.img", args: ["hosted-signals"] },
  { image: "requests.img", args: ["hosted", join(out, "requests.tmp")] },
];
for (const way of ["", "winmem", "overlay"])
  for (const t of small) {
    const r = run([hostLinux, join(images, t.image), ...t.args], { ...process.env, BUN_HOST_TEST: way, LLVM_PROFILE_FILE: join(out, "posix-%p.profraw") });
    console.log(`${t.image} hosted ${way}: exit code ${r.code}`);
  }
// The ways of the host that no passing run takes: the trace, and the end of an image that
// issues a syscall itself (exit code 99).
for (const t of [
  { image: "threads.img", args: [join(out, "probe.tmp")], env: { BUN_HOST_TRACE: "2" } },
  { image: "raw_syscall.img", args: [], env: {} },
]) {
  const r = run([hostLinux, join(images, t.image), ...t.args], { ...process.env, ...t.env, LLVM_PROFILE_FILE: join(out, "posix-%p.profraw") });
  console.log(`${t.image} hosted ${Object.keys(t.env).join(" ")}: exit code ${r.code}`);
}
const scenarios = (modes: string, profile: string) =>
  run(["bun", join(tree, "test/jsc_scenarios.ts"), "--runs", runs, "--modes", modes, "--host", hostLinux, "--out", join(out, `scenarios-${modes.replace(/,/g, "-")}.json`)], { ...process.env, LLVM_PROFILE_FILE: join(out, profile) }, "inherit");
scenarios("hosted,winmem,overlay", "posix-%p.profraw");

const result: Record<string, unknown> = {};
for (const [name, binary, source] of [["posix", hostLinux, "host_posix.c"]] as const) {
  const raw = readdirSync(out).filter(f => f.startsWith(`${name}-`) && f.endsWith(".profraw")).map(f => join(out, f));
  must([`${llvm}/llvm-profdata`, "merge", "-o", join(out, `${name}.profdata`), ...raw]);
  const exported = JSON.parse(must([`${llvm}/llvm-cov`, "export", "-format=text", `-instr-profile=${join(out, `${name}.profdata`)}`, binary]));
  const functions = exported.data[0].functions as { name: string; count: number; filenames: string[] }[];
  const names = (list: typeof functions) => [...new Set(list.map(f => f.name.replace(/^.*:/, "")))].sort();
  const ran = names(functions.filter(f => f.count > 0));
  const never = names(functions.filter(f => f.count === 0)).filter(n => !ran.includes(n));
  const lines = exported.data[0].totals.lines;
  result[name] = { source, profiles: raw.length, functions: ran.length + never.length, functions_never_run: never, lines: lines.count, lines_run: lines.covered };
  console.log(`${source}: ${raw.length} runs, ${ran.length} of ${ran.length + never.length} functions ran, ${lines.covered} of ${lines.count} lines. Never run: ${never.join(", ") || "none"}`);
  writeFileSync(join(out, `${name}-lines.txt`), must([`${llvm}/llvm-cov`, "show", `-instr-profile=${join(out, `${name}.profdata`)}`, binary]));
}
writeFileSync(join(out, "coverage.json"), JSON.stringify(result, null, 1) + "\n");
