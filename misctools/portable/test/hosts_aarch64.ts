// The tests of the aarch64 test host that came with signals, with code that is written and
// with the check of x18. test/run.sh aarch64 has the older ones, and comes first.
//
//   bun test/hosts_aarch64.ts [--runs 5] [--out <tree>/out/aarch64]
//
// After "bun jsc/build-aarch64.ts small" (the images have the libc of the jsc image), or
// after "sh build.sh aarch64" (the libc that build.sh builds by itself): both pass.
//
// Prints one line for each test, "<name>: <passes> of <runs>", and fails if a run failed.
// A test passes with the exit code and the line of output that it names.
//
// The host checks at every request and at every signal that x18 is what it put there (exit
// code 96). variants/x18_clobber.img (test/x18_clobber.c, built here) writes x18 on purpose:
// its "must fail" runs show that the check of the host and the static check
// (test/check_aarch64.ts) are real.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const tree = resolve(dirname(import.meta.path), "..");
const option = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const runs = Number(option("runs", "5"));
const out = resolve(option("out", join(tree, "out/aarch64")));
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const emulator = process.arch === "arm64" ? [] : ["qemu-aarch64"];
const host = join(out, "host-linux");
const variants = join(out, "variants");
const sysroot = join(out, "sysroot");
if (!existsSync(host) || !existsSync(join(sysroot, "lib/libc.a"))) throw new Error(`${out}: "bun jsc/build-aarch64.ts small" or "sh build.sh aarch64" comes first`);
mkdirSync(variants, { recursive: true });
let failed = 0;

function must(what: string, cmd: string[]) {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${what}: exit code ${r.exitCode}\n${r.stderr}`);
  return r.stdout.toString();
}
function expect(code: number, pattern: RegExp, name: string, cmd: string[], env: Record<string, string> = {}) {
  let passes = 0;
  for (let i = 1; i <= runs; i++) {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("BUN_HOST_"))) as Record<string, string>;
    const r = Bun.spawnSync([...emulator, ...cmd], { env: { ...clean, ...env }, stdout: "pipe", stderr: "pipe", cwd: out, timeout: 600_000 });
    const text = r.stdout.toString() + r.stderr.toString();
    if (r.exitCode === code && pattern.test(text)) passes++;
    else console.log(`  ${name}: run ${i}: exit code ${r.exitCode}${r.signalCode ? ` (${r.signalCode})` : ""}, wanted ${code}. Output:\n${text.split("\n").map(l => "    " + l).join("\n")}`);
  }
  console.log(`${name}: ${passes} of ${runs}`);
  if (passes !== runs) failed++;
}
function report(name: string, ok: boolean, detail: string) {
  console.log(`${name}: ${ok ? "passed" : "FAILED"}`);
  if (!ok) {
    failed++;
    console.log(detail.split("\n").map(l => "    " + l).join("\n"));
  }
}

// The image that writes x18: compiled and linked like the images of build.sh.
const resource = must("clang", [`${llvm}/clang`, "-print-resource-dir"]).trim();
const builtins = join(out, "builtins/lib/linux/libclang_rt.builtins-aarch64.a");
const clobber = join(variants, "x18_clobber.img");
must("compile x18_clobber.c", [`${llvm}/clang`, "--target=aarch64-linux-musl", "-O2", "-nostdinc", "-isystem", join(sysroot, "include"), "-isystem", join(resource, "include"),
  "-femulated-tls", "-ffixed-x18", "-fno-stack-protector", "-fPIE", "-c", "-o", join(variants, "x18_clobber.o"), join(tree, "test/x18_clobber.c")]);
must("link x18_clobber.img", [`${llvm}/ld.lld`, "-static", "-pie", "--no-dynamic-linker", "-z", "noexecstack", "-z", "max-page-size=65536", "-z", "separate-loadable-segments", "-o", clobber,
  join(sysroot, "lib/rcrt1.o"), join(sysroot, "lib/crti.o"), join(variants, "x18_clobber.o"), `-L${join(sysroot, "lib")}`, "-lc", builtins, "-lc", join(sysroot, "lib/crtn.o")]);

const images = ["threads", "linux_paths", "requests"].map(n => join(out, `${n}.img`));
const checked = Bun.spawnSync(["bun", join(tree, "test/check_aarch64.ts"), ...images.flatMap(i => ["--image", i])], { stdout: "pipe", stderr: "pipe" });
report("aarch64 static checks of the images, every instruction that names x18", checked.exitCode === 0, checked.stdout.toString());
const control = Bun.spawnSync(["bun", join(tree, "test/check_aarch64.ts"), "--image", clobber, "--expect-x18-writes"], { stdout: "pipe", stderr: "pipe" });
report("aarch64 must fail: static check of an image that writes x18", control.exitCode === 0 && /WRITE .* in clobber/.test(control.stdout.toString()), control.stdout.toString());

// Copies with traps in place of what a host that is not Linux must not run (test/rewrite_insn.py).
const trapped = join(variants, "linux_paths.x18-only.img");
must("rewrite", ["python3", join(tree, "test/rewrite_insn.py"), join(out, "linux_paths.img"), trapped, "no-svc", "no-tpidr", "no-tpidrro"]);
must("chmod", ["chmod", "+x", trapped]);

const threads = /^m2: threads=8 total=204263652 thread_locals_ok=8\/8 main_tls=unset file_roundtrip=1 wall_year_ok=1 pid_ok=1 /m;
const paths = /^linux_paths: mode=hosted-signals vfork=1 signal=1 cancel=1 main_tls=7 stack=1 mask=1 thread_signal=1 fault=1 maperr=1 tls_align=1 vectors=1$/m;
const requests = /^requests: mode=hosted checks=[0-9]* failures=0/m;
expect(42, /^linux_paths: mode=direct .* tls_align=1 vectors=1$/m, "aarch64 linux_paths direct, with the vector registers in the signal context", [join(out, "linux_paths.img"), "direct"]);
expect(42, paths, "aarch64 linux_paths hosted with signals (x18)", [host, join(out, "linux_paths.img"), "hosted-signals"]);
expect(42, paths, "aarch64 linux_paths hosted with signals (x18), traps on svc, tpidr_el0, tpidrro_el0", [host, trapped, "hosted-signals"]);
expect(42, requests, "aarch64 requests hosted with signals (x18)", [host, join(out, "requests.img"), "hosted", join(out, "requests.tmp")]);
// The ways of the test host that stand for another system: the memory model of Windows,
// pages that are discarded as on macOS, memory for code that is writable or executable for a
// thread, and pages of 16 KiB, which is macOS on Apple Silicon.
for (const [key, value] of [["BUN_HOST_TEST", "winmem"], ["BUN_HOST_TEST", "overlay"], ["BUN_HOST_TEST", "jitwx"], ["BUN_HOST_PAGE", "16384"]]) {
  const way = `${key}=${value}`;
  expect(42, threads, `aarch64 threads hosted, ${way}`, [host, join(out, "threads.img"), join(out, "probe.tmp")], { [key]: value });
  expect(42, paths, `aarch64 linux_paths hosted with signals, ${way}`, [host, join(out, "linux_paths.img"), "hosted-signals"], { [key]: value });
  expect(42, requests, `aarch64 requests hosted, ${way}`, [host, join(out, "requests.img"), "hosted", join(out, "requests.tmp")], { [key]: value });
}
expect(42, /^x18_clobber: mode=request/m, "aarch64 x18_clobber direct (x18 is a register like the others on Linux)", [clobber, "request"]);
expect(42, /^x18_clobber: mode=keep pid_ok=1 joined=1 detached=1/m, "aarch64 control: hosted, x18 is read and written back as it was", [host, clobber, "keep"]);
for (const way of ["request", "fault", "thread", "detached"])
  expect(96, /^host: the image changed x18: it is 0x1234/m, `aarch64 must fail: hosted, image that writes x18 (${way})`, [host, clobber, way]);
process.exit(failed ? 1 : 0);
