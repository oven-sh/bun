// Compiles the hosts of the portable image for the systems that the machine that builds the image
// cannot run, as far as it has what that takes. Nothing is run.
//
//   bun check.ts      after ../build.ts x86_64 and ../build.ts aarch64 (the headers of musl), and
//                     ../tools/windows-sdk.ts. WORK as in ../slice/build.ts.
//
//   Windows x64       ../loop/check-windows.ts compiles and links host_win.c with libuv
//   Windows arm64     host_win.c is compiled against the headers of the Windows SDK, not linked (the
//                     libraries that were fetched are the ones for x64). x18 is the TEB there: the host
//                     may read it, and nothing may write it.
//   macOS             there is no SDK of macOS here. The branches of host_posix.c for macOS are compiled
//                     to Mach-O objects, for arm64 and x86-64, with the headers of musl in the place of
//                     the SDK and mac_declarations.h for what they do not have: that checks the syntax,
//                     the types and the assembly, and not one declaration of macOS. On arm64 the code
//                     of the host must not use x18, which macOS keeps for itself.
//
// Exit code 1 if a check fails.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const work = resolve(process.env.WORK ?? "/tmp/portable/n2");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const sdk = resolve(process.env.SDK ?? join(work, "winsdk"));
const out = join(work, "hostcheck");
mkdirSync(out, { recursive: true });
const warnings = ["-Wall", "-Wextra", "-Wno-unused-parameter"];

function run(cmd: string[]) {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", maxBuffer: 1 << 28 });
  return { ok: result.exitCode === 0, text: result.stdout.toString() + result.stderr.toString(), stdout: result.stdout.toString() };
}
let failed = false;
function report(name: string, ok: boolean, facts: Record<string, unknown>) {
  if (!ok) failed = true;
  console.log(`${ok ? "ok    " : "FAILED"} ${name}: ${JSON.stringify(facts)}`);
}
/** The instructions of an object file that name x18 or w18, without the ones that match `allowed`. */
function usesOfX18(object: string, allowed?: RegExp) {
  return run([`${llvm}/llvm-objdump`, "-d", "--no-show-raw-insn", object])
    .stdout.split("\n")
    .filter(line => /\b[xw]18\b/.test(line) && !(allowed && allowed.test(line)))
    .map(line => line.trim());
}

{
  const configuration = join(sdk, "windows-x64.cfg");
  if (!existsSync(configuration)) throw new Error(`${configuration} is not there: ../tools/windows-sdk.ts makes it`);
  const object = join(out, "host_win.arm64.obj");
  const compiled = run([`${llvm}/clang`, `--config=${configuration}`, "--target=aarch64-pc-windows-msvc", "-O2", ...warnings, "-c", "-o", object, join(here, "host_win.c")]);
  const other = compiled.ok ? usesOfX18(object, /\tmov\tx[0-9]+, x18$/) : [];
  report("host_win.c for Windows on arm64, compiled and not linked", compiled.ok && other.length === 0, {
    errors: [...compiled.text.matchAll(/error: (.*)$/gm)].map(match => match[1].slice(0, 160)),
    uses_of_x18_that_are_not_a_read: other,
  });
}
for (const [apple, arch, sysroot] of [
  ["arm64", "aarch64", join(work, "musl-aarch64/sysroot")],
  ["x86_64", "x86_64", join(work, "musl/sysroot")],
]) {
  if (!existsSync(join(sysroot, "include/pthread.h"))) throw new Error(`${sysroot} is not there: ../build.ts ${arch} makes it`);
  const resource = run([`${llvm}/clang`, "-print-resource-dir"]).stdout.trim();
  const object = join(out, `host_posix.${apple}.o`);
  const compiled = run([
    `${llvm}/clang`, `--target=${apple}-apple-macos11`, "-O2", ...warnings, "-Wno-missing-field-initializers", "-nostdinc",
    "-isystem", join(sysroot, "include"), "-isystem", join(resource, "include"), "-include", join(here, "mac_declarations.h"),
    "-c", "-o", object, join(here, "host_posix.c"),
  ]);
  const uses = compiled.ok && apple === "arm64" ? usesOfX18(object) : [];
  report(`host_posix.c, the branches for macOS, for ${apple}: syntax and types, with the headers of musl`, compiled.ok && uses.length === 0, {
    errors: [...compiled.text.matchAll(/error: (.*)$/gm)].map(match => match[1].slice(0, 160)),
    warnings: [...compiled.text.matchAll(/warning: (.*)$/gm)].map(match => match[1].slice(0, 120)),
    ...(apple === "arm64" ? { uses_of_x18: uses } : {}),
  });
}
process.exit(failed ? 1 : 0);
