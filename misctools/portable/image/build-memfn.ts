// Builds the replacements for libc's memory functions that the portable image links in front of musl's:
// memcpy, memmove, memset, memcmp, bcmp of LLVM libc, compiled with the image's ABI flags.
//
//   bun /tmp/portable/m4/build-memfn.ts <llvm-project checkout> <sysroot> [<out dir>]
//
// <out dir> defaults to <sysroot>/usr/lib/portable-memfn, which is where bun's build looks
// (scripts/build/config.ts portableMemFunctionObjects). The llvm-project checkout should be the commit of the
// clang in use (here 069ef0e7cb36, /tmp/portable/jsc/src/llvm-project).
//
// The functions are chosen at compile time for -march=nehalem (bun's x64 floor): SSE2/SSE4 code paths, no
// run-time dispatch, so no ifunc, which a static image could not resolve anyway.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const [llvmArg, sysrootArg, outArg] = process.argv.slice(2);
if (llvmArg === undefined || sysrootArg === undefined) {
  console.error("usage: bun build-memfn.ts <llvm-project checkout> <sysroot> [<out dir>]");
  process.exit(2);
}
const llvm = resolve(llvmArg);
const sysroot = resolve(sysrootArg);
const out = resolve(outArg ?? join(sysroot, "usr", "lib", "portable-memfn"));
const clangxx = process.env.CXX ?? "/usr/lib/llvm-current/bin/clang++";

export const functions = ["memcpy", "memmove", "memset", "memcmp", "bcmp"];
export const flags = [
  "--target=x86_64-linux-musl",
  `--sysroot=${sysroot}`,
  `-resource-dir=${join(sysroot, "clang-resource-dir")}`,
  "-stdlib++-isystem",
  join(sysroot, "usr", "include", "c++", "v1"),
  // the image's ABI
  "-mno-red-zone",
  "-femulated-tls",
  "-fPIE",
  "-march=nehalem",
  "-O3",
  "-DNDEBUG",
  "-std=c++20",
  "-fno-exceptions",
  "-fno-rtti",
  "-fno-stack-protector",
  "-fno-unwind-tables",
  "-fno-asynchronous-unwind-tables",
  "-ffunction-sections",
  "-fdata-sections",
  // The compiler must not turn the body of memcpy into a call of memcpy.
  "-ffreestanding",
  "-fno-builtin",
  // LLVM libc as a source library: its own namespace, and the public C names as aliases of its functions.
  `-I${join(llvm, "libc")}`,
  "-DLIBC_NAMESPACE=__llvm_libc_bun_portable",
  "-DLIBC_COPT_PUBLIC_PACKAGING",
];

mkdirSync(out, { recursive: true });
for (const name of functions) {
  const source = join(llvm, "libc", "src", "string", `${name}.cpp`);
  // bcmp lives in src/strings in newer trees.
  const candidates = [source, join(llvm, "libc", "src", "strings", `${name}.cpp`)];
  const found = candidates.find(p => Bun.file(p).size > 0);
  if (found === undefined) throw new Error(`no source for ${name}: ${candidates.join(", ")}`);
  const object = join(out, `${name}.o`);
  const argv = [clangxx, ...flags, "-c", found, "-o", object];
  const result = Bun.spawnSync(argv, { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    console.error(`failed: ${argv.join(" ")}`);
    process.exit(1);
  }
  console.log(`${name}: ${object}`);
}
