// Compiles the branches of host/host_posix.c that are for macOS, on a machine that has no headers of
// macOS.
//
//   bun check-macos-host.ts [--sysroot <include directory of a libc>]
//
// clang has the targets of macOS, and what the host includes is there in every libc under the same
// names. So the host is compiled for arm64 and for x86-64 macOS against the headers of the libc of the
// image, with test/macos_shim.h for what only macOS has, and nothing is linked. That shows that the
// branches for macOS are C that the compiler takes, with the types that the shim and those headers
// give them: a misspelled name, a missing bracket, a call with the wrong arguments. It does not show
// that the headers of macOS say the same: only a Mac does (cc -O2 -o host host_posix.c).
//
// Each processor is compiled as the host is built on a Mac, and once more with
// -DBUN_HOST_WITHOUT_FILES, which is what run-on-mac.sh falls back to.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const argv = process.argv.slice(2);
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const resource = Bun.spawnSync([`${llvm}/clang`, "-print-resource-dir"], { stdout: "pipe" }).stdout.toString().trim();
let failed = 0;
for (const [apple, arch] of [["arm64", "aarch64"], ["x86_64", "x86_64"]]) {
  const include = argv.includes("--sysroot") ? argv[argv.indexOf("--sysroot") + 1] : join(work, `musl-${arch}/sysroot/include`);
  if (!existsSync(include)) throw new Error(`${include}: no headers (../build.sh ${arch} makes them)`);
  for (const defines of [[], ["-DBUN_HOST_WITHOUT_FILES"]]) {
    const command = [
      `${llvm}/clang`, `--target=${apple}-apple-macos11`, "-O2", "-Wall", "-Wextra", "-Wno-unused-parameter", "-Wno-missing-field-initializers", "-Werror", "-ferror-limit=0",
      "-nostdinc", "-isystem", include, "-isystem", join(resource, "include"), "-include", join(here, "macos_shim.h"), ...defines, "-fsyntax-only", join(here, "../host/host_posix.c"),
    ];
    const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
    const messages = result.stderr.toString().trim();
    const what = `host_posix.c for ${apple} macOS${defines.length ? `, ${defines.join(" ")}` : ""}`;
    if (result.exitCode === 0 && !messages) console.log(`${what}: the compiler takes it`);
    else {
      failed++;
      console.log(`${what}: NOT ACCEPTED\n${messages.split("\n").slice(0, 40).join("\n")}`);
    }
  }
}
process.exit(failed ? 1 : 0);
