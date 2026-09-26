/**
 * The ABI of the portable image, defined once. The build of the libc and every other step take their
 * compiler and linker flags from here, and nothing else spells them.
 *
 * An image is one static-pie ELF file per CPU architecture, compiled for Linux with musl. The same file
 * runs on Linux by itself, and on Windows and macOS through a native host (host/). What the other two
 * systems do with a thread's registers and stack decides the flags.
 */

import { dirname, join } from "node:path";

export type Arch = "x86_64" | "aarch64";

export const ARCHES: readonly Arch[] = ["x86_64", "aarch64"];

/** The target that clang compiles an image for. */
export function targetOf(arch: Arch): string {
  return `${arch}-linux-musl`;
}

/** The same target the way clang names its directory of runtime libraries, and Rust its target. */
export function tripleOf(arch: Arch): string {
  return `${arch}-unknown-linux-musl`;
}

/** The architecture of the machine that runs the build. */
export function hostArch(): Arch {
  if (process.arch === "x64") return "x86_64";
  if (process.arch === "arm64") return "aarch64";
  throw new Error(`the portable image has no build for a ${process.arch} machine`);
}

/**
 * Code generation flags of the ABI. Every object of an image is compiled with all of them: the libc,
 * compiler-rt, the C++ runtime, ICU, the allocator, JavaScriptCore, and the program.
 */
export function abiFlags(arch: Arch): string[] {
  return [
    // x86_64: Windows x64 has no red zone, it may write below the stack pointer at any time.
    // aarch64: x18 is reserved on Windows (the TEB) and on macOS. The image never writes it.
    arch === "x86_64" ? "-mno-red-zone" : "-ffixed-x18",
    // The canary of the stack protector is a thread local of the libc, read through fs or tpidr_el0.
    "-fno-stack-protector",
    // The host maps the image wherever it finds room.
    "-fPIE",
    // No thread-local storage of the compiler: it reads the thread pointer register of Linux. A thread
    // local is a call of __emutls_get_address, which the libc answers (libc/patch_musl.ts).
    "-femulated-tls",
  ];
}

/** The oldest CPU that bun runs on (scripts/build/flags.ts, cpuTargetFlags). Not part of the ABI. */
export function cpuFlags(arch: Arch): string[] {
  return arch === "x86_64" ? ["-march=nehalem"] : ["-march=armv8-a+crc"];
}

/**
 * Linker options of every image (the spelling of ld.lld; a link through the clang driver passes each with
 * `driverLinkFlags`). 64 KiB is the allocation granularity of Windows and more than the 16 KiB pages of
 * macOS on arm64: segments that start on such a boundary can be mapped one by one, each with its protection.
 */
export const IMAGE_LINK_FLAGS: readonly string[] = ["-z", "max-page-size=65536", "-z", "separate-loadable-segments"];

/** `IMAGE_LINK_FLAGS` for a link that the clang driver runs. */
export function driverLinkFlags(): string[] {
  const flags: string[] = [];
  for (let i = 0; i < IMAGE_LINK_FLAGS.length; i += 2)
    flags.push(`-Wl,${IMAGE_LINK_FLAGS[i]},${IMAGE_LINK_FLAGS[i + 1]}`);
  return flags;
}

// ───────────────────────────────────────────────────────────────────────────
// The sysroot
// ───────────────────────────────────────────────────────────────────────────

/** Where the parts of a sysroot are. `bun scripts/build.ts --profile=portable` reads the same layout. */
export interface Sysroot {
  root: string;
  /** musl's headers, libc++'s in c++/v1, ICU's in unicode, the kernel's in linux, asm and asm-generic. */
  include: string;
  /** libc.a and musl's crt objects, libc++.a, libc++abi.a, libunwind.a, the ICU libraries. */
  lib: string;
  /** clang's own headers and, in lib/<triple>, compiler-rt's builtins and crt objects. */
  resourceDir: string;
  builtins: string;
  /** memcpy, memmove, memset, memcmp and bcmp of LLVM libc. An image links them in front of the libc. */
  memfn: string;
}

export function sysrootAt(root: string, arch: Arch): Sysroot {
  const resourceDir = join(root, "clang-resource-dir");
  return {
    root,
    include: join(root, "usr", "include"),
    lib: join(root, "usr", "lib"),
    resourceDir,
    builtins: join(resourceDir, "lib", tripleOf(arch), "libclang_rt.builtins.a"),
    memfn: join(root, "usr", "lib", "portable-memfn"),
  };
}

/** The functions of `Sysroot.memfn`, one object each. */
export const MEMORY_FUNCTIONS: readonly string[] = ["memcpy", "memmove", "memset", "memcmp", "bcmp"];

/**
 * What tells clang to compile for the image against a sysroot: target, headers and runtime libraries of the
 * sysroot only, and the ABI. Without -resource-dir the driver takes the builtins of the machine's clang,
 * which are compiled with a red zone.
 */
export function compileFlags(arch: Arch, sysroot: Sysroot): string[] {
  return [
    `--target=${targetOf(arch)}`,
    `--sysroot=${sysroot.root}`,
    `-resource-dir=${sysroot.resourceDir}`,
    ...abiFlags(arch),
  ];
}

/**
 * For C++ in addition: the headers of the sysroot's libc++, in front of the ones that the machine's clang
 * brings along (which are configured for another libc).
 */
export function cxxIncludeFlags(sysroot: Sysroot): string[] {
  return ["-stdlib++-isystem", join(sysroot.include, "c++", "v1")];
}

/** A link through the clang driver: static-pie, lld, and the runtime libraries of the sysroot. */
export function driverRuntimeFlags(): string[] {
  return ["-fuse-ld=lld", "-static-pie", "-rtlib=compiler-rt", "-unwindlib=libunwind"];
}

// ───────────────────────────────────────────────────────────────────────────
// Tools
// ───────────────────────────────────────────────────────────────────────────

/** The directory of clang, ld.lld and the llvm tools: $LLVM_BIN, or where the clang of PATH is. */
export function llvmBin(): string {
  const fromEnvironment = process.env.LLVM_BIN;
  if (fromEnvironment !== undefined && fromEnvironment !== "") return fromEnvironment;
  const clang = Bun.which("clang");
  if (clang === null) throw new Error("no clang in PATH: install LLVM, or set LLVM_BIN to its bin directory");
  return dirname(clang);
}

/** The root of bun's repository: this file is misctools/portable/flags.ts. */
export const REPOSITORY: string = join(import.meta.dir, "..", "..");

/** misctools/portable. */
export const TREE: string = import.meta.dir;
