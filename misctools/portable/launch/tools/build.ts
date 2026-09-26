// Builds the parts this Linux machine can build and packs both architectures.
//
//   bun tools/build.ts [--arch x86_64|aarch64] [--out DIR] [--images DIR] [--image PATH]
//                      [--win-host-dir DIR] [--macos-stub-dir DIR]
//
//   --out      where everything goes that is built here. Default: build/portable/launch
//              in the repository.
//   --images   the directory that holds the output directories of
//              misctools/portable/build.ts, one for each architecture:
//              <images>/<arch>/threads.img and <images>/<arch>/sysroot. Default:
//              build/portable in the repository, where
//              `bun misctools/portable/build.ts test-image --arch <arch>` builds.
//
// Parts, per architecture:
//   linux stub    stub/linux_stub.c, freestanding, no libc, clang + ld.lld.
//                 It is the loader stub the shell header writes to the cache.
//   windows host  an INPUT FILE. A person builds it on real Windows with
//                 clang for the MSVC target (bun tools/windows-host.ts prints
//                 the commands). --win-host-dir holds host-x64.exe and
//                 host-arm64.exe; the default is build/portable/inputs/windows in the repository.
//   macos stub    an INPUT FILE as well: host/host_posix.c built on a Mac with
//                 cc (bun tools/mac-stub.ts prints that script). Without
//                 --macos-stub-dir the packed file has no macOS stub and its
//                 shell header says so on macOS.
//   macos check   ../host/host_posix.c compiled to a Mach-O object with the musl
//                 headers of the sysroot and test/mac_shim.h in place of the
//                 Apple SDK. A compile check, nothing is linked or run.
//   image         <images>/<arch>/threads.img from misctools/portable/build.ts, and
//                 <out>/<arch>/bigbss.img, built here from test/bigbss.c.
//
// The stub is linked without a build id and stripped, and the packer adds
// nothing of this machine, so the bytes depend on the sources and the
// compiler only: two builds give the same file.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_LINK_FLAGS, REPOSITORY, TREE, abiFlags, llvmBin, sysrootAt, targetOf } from "../../flags.ts";
import { ELF_MACHINE, type Arch } from "./format.ts";

const here = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const LLVM = llvmBin();
/** The sources of the two hosts. */
const HOSTS = join(TREE, "host");
export const DEFAULT_OUT = join(REPOSITORY, "build", "portable", "launch");
export const DEFAULT_IMAGES = join(REPOSITORY, "build", "portable");
export const WIN_HOSTS = process.env.PORTABLE_WIN_HOSTS ?? join(REPOSITORY, "build", "portable", "inputs", "windows");
/** The name of the Windows host input file, per architecture. */
const WIN_HOST_NAME: Record<Arch, string> = { x86_64: "host-x64.exe", aarch64: "host-arm64.exe" };

function run(cmd: string[], what: string) {
  const p = Bun.spawnSync({ cmd, stderr: "pipe", stdout: "pipe" });
  if (!p.success) throw new Error(`${what} failed:\n${cmd.join(" ")}\n${p.stderr.toString()}${p.stdout.toString()}`);
  const warnings = p.stderr.toString().trim();
  if (warnings) console.log(`  ${what}: ${warnings.split("\n").length} line(s) on stderr:\n${warnings}`);
}

/**
 * The Linux loader stub: freestanding, not linked against any libc.
 *   - It has to run on any Linux machine, so it cannot need a libc of the
 *     system; it is written against the kernel, nothing else.
 *   - The patched musl in <images>/<arch>/sysroot is the libc OF THE IMAGE: it
 *     knows the host table (AT_BUN_HOST). The stub is not the image and has
 *     no business carrying that libc.
 *   - It needs the start stack as the kernel hands it over (argc, argv, envp
 *     and the auxiliary vector, which it passes on to the image), which is
 *     what a freestanding _start gets.
 * Size is the smaller reason: a static musl program that does nothing but one
 * write(2) is 4328 bytes stripped against this stub's 2944, so musl would
 * cost something but not much.
 * The stub issues its syscalls inline and brings its own memcpy and memset.
 * -fno-builtin keeps clang from turning those two loops into calls to
 * themselves.
 */
export function buildLinuxStub(arch: Arch, out: string): string {
  const exe = `${out}/linux-stub-${arch}`;
  run(
    [
      `${LLVM}/clang`,
      `--target=${arch}-linux-gnu`,
      "-Oz",
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Wno-unused-parameter",
      "-nostdlib",
      "-static",
      "-ffreestanding",
      "-fno-builtin",
      "-fno-stack-protector",
      "-fno-asynchronous-unwind-tables",
      "-fno-unwind-tables",
      "-fomit-frame-pointer",
      "-ffunction-sections",
      "-fdata-sections",
      "-fuse-ld=lld",
      "-Wl,--build-id=none",
      "-Wl,--gc-sections",
      "-Wl,-z,noexecstack",
      "-Wl,-z,max-page-size=4096",
      "-Wl,-e,_start",
      "-o",
      exe,
      `${here}/stub/linux_stub.c`,
    ],
    `linux stub ${arch}`,
  );
  run([`${LLVM}/llvm-strip`, "--strip-all", exe], `strip the linux stub ${arch}`);
  return exe;
}

/** The sysroot that misctools/portable/build.ts made for an architecture. */
function sysrootOf(arch: Arch, images: string) {
  const sysroot = sysrootAt(`${images}/${arch}/sysroot`, arch);
  if (!existsSync(`${sysroot.lib}/libc.a`) || !existsSync(sysroot.builtins)) {
    throw new Error(
      `no sysroot at ${sysroot.root}: run bun misctools/portable/build.ts test-image --arch ${arch} --out ${images}/${arch} first`,
    );
  }
  return sysroot;
}

/**
 * A second test image, built the way misctools/portable/build.ts builds one
 * (steps/images.ts): static-pie against the patched musl sysroot, with the
 * flags of the image, segments 64 KiB apart. Its
 * .bss is several pages, which the threaded test image does not have, so it
 * reaches the part of the loader stub that maps anonymous zero pages after
 * the file pages of a writable segment.
 */
export function buildBigBssImage(arch: Arch, out: string, images: string): string {
  const sysroot = sysrootOf(arch, images);
  mkdirSync(`${out}/${arch}`, { recursive: true });
  const img = `${out}/${arch}/bigbss.img`;
  run(
    [
      `${LLVM}/clang`,
      `--target=${targetOf(arch)}`,
      "-O2",
      "-nostdinc",
      "-isystem",
      sysroot.include,
      "-isystem",
      `${sysroot.resourceDir}/include`,
      ...abiFlags(arch),
      "-c",
      "-o",
      `${out}/${arch}/bigbss.o`,
      `${here}/test/bigbss.c`,
    ],
    `bigbss.c ${arch}`,
  );
  run(
    [
      `${LLVM}/ld.lld`,
      "-static",
      "-pie",
      "--no-dynamic-linker",
      "-z",
      "noexecstack",
      ...IMAGE_LINK_FLAGS,
      "-o",
      img,
      `${sysroot.lib}/rcrt1.o`,
      `${sysroot.lib}/crti.o`,
      `${out}/${arch}/bigbss.o`,
      `-L${sysroot.lib}`,
      "-lc",
      sysroot.builtins,
      "-lc",
      `${sysroot.lib}/crtn.o`,
    ],
    `link bigbss ${arch}`,
  );
  return img;
}

/**
 * The macOS branches of ../host/host_posix.c, compiled to a Mach-O object for the
 * architecture of the image. There is no Apple SDK on this machine, so the
 * musl headers of the sysroot and test/mac_shim.h stand in for it and nothing
 * is linked. A real macOS stub is an input file built on a Mac.
 */
export function buildMacObject(arch: Arch, out: string, images: string): string {
  const apple = arch === "aarch64" ? "arm64" : "x86_64";
  const o = `${out}/mac/host_posix.${apple}.o`;
  const sysroot = sysrootOf(arch, images);
  run(
    [
      `${LLVM}/clang`,
      `--target=${apple}-apple-macos11`,
      "-O2",
      "-Wall",
      "-Wextra",
      "-Wno-unused-parameter",
      "-Wno-missing-field-initializers",
      "-nostdinc",
      "-isystem",
      sysroot.include,
      "-isystem",
      `${sysroot.resourceDir}/include`,
      "-include",
      `${here}/test/mac_shim.h`,
      "-c",
      "-o",
      o,
      `${HOSTS}/host_posix.c`,
    ],
    `host_posix.c for ${apple} macOS`,
  );
  return o;
}

/** The POSIX host as a Linux program, to test the host path of the container. */
export function buildLinuxHost(arch: Arch, out: string, images: string): string {
  const exe = `${out}/host-linux-${arch}`;
  if (arch === "x86_64") {
    run(
      [`${LLVM}/clang`, "-O2", "-Wall", "-Wno-unused-function", "-o", exe, `${HOSTS}/host_posix.c`, "-lpthread"],
      "linux host x86_64",
    );
    return exe;
  }
  // aarch64: a static program whose libc is the sysroot of the image, built
  // without -ffixed-x18, the way misctools/portable/build.ts builds it.
  const sysroot = sysrootOf(arch, images);
  run(
    [
      `${LLVM}/clang`,
      `--target=aarch64-linux-musl`,
      "-O2",
      "-nostdinc",
      "-isystem",
      sysroot.include,
      "-isystem",
      `${sysroot.resourceDir}/include`,
      "-fno-stack-protector",
      "-c",
      "-o",
      `${out}/host-posix-aarch64.o`,
      `${HOSTS}/host_posix.c`,
    ],
    "linux host aarch64 (compile)",
  );
  run(
    [
      `${LLVM}/ld.lld`,
      "-static",
      "-z",
      "noexecstack",
      "-o",
      exe,
      `${sysroot.lib}/crt1.o`,
      `${sysroot.lib}/crti.o`,
      `${out}/host-posix-aarch64.o`,
      `-L${sysroot.lib}`,
      "-lc",
      sysroot.builtins,
      "-lc",
      `${sysroot.lib}/crtn.o`,
    ],
    "linux host aarch64 (link)",
  );
  return exe;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) opt[args[i].replace(/^--/, "")] = args[++i];
  const out = opt.out ?? DEFAULT_OUT;
  const images = opt.images ?? DEFAULT_IMAGES;
  const arches: Arch[] = opt.arch ? [opt.arch as Arch] : ["x86_64", "aarch64"];
  const winDir = opt["win-host-dir"] ?? WIN_HOSTS;
  for (const dir of ["stub", "pack", "mac", "macstub"]) await mkdir(`${out}/${dir}`, { recursive: true });
  const key = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);

  for (const arch of arches) {
    if (!(arch in ELF_MACHINE)) throw new Error(`unknown architecture ${arch}`);
    console.log(`${arch}:`);
    const stub = buildLinuxStub(arch, `${out}/stub`);
    console.log(`  linux stub   ${stub} ${Bun.file(stub).size} bytes (${key(stub)})`);
    const winHost = `${winDir}/${WIN_HOST_NAME[arch]}`;
    if (!existsSync(winHost))
      throw new Error(`no Windows host at ${winHost} (bun tools/windows-host.ts prints how a person builds it)`);
    console.log(
      `  windows host ${winHost} ${Bun.file(winHost).size} bytes (${key(winHost)}), an input file built on Windows`,
    );
    const macosStub = opt["macos-stub-dir"] ? `${opt["macos-stub-dir"]}/macos-stub-${arch}` : "";
    const haveMacos = !!macosStub && existsSync(macosStub);
    console.log(
      `  macos stub   ${haveMacos ? `${macosStub} ${Bun.file(macosStub).size} bytes (${key(macosStub)})` : "absent, packing without it"}`,
    );
    const macObject = buildMacObject(arch, out, images);
    console.log(
      `  macos check  ${macObject} ${Bun.file(macObject).size} bytes (compiled, not linked: no Apple SDK here)`,
    );
    const host = buildLinuxHost(arch, out, images);
    console.log(`  linux host   ${host} ${Bun.file(host).size} bytes (the POSIX host, to test the host path)`);
    const toPack = opt.image ? [opt.image] : [`${images}/${arch}/threads.img`, buildBigBssImage(arch, out, images)];
    for (const image of toPack) {
      const name = image.replace(/.*\//, "").replace(/\.img$/, "");
      const packed = `${out}/pack/${name}-${arch}.com`;
      const cmd = [
        "bun",
        `${here}/tools/pack.ts`,
        "--arch",
        arch,
        "--image",
        image,
        "--win-host",
        winHost,
        "--linux-stub",
        stub,
        ...(haveMacos ? ["--macos-stub", macosStub] : []),
        "-o",
        packed,
        "--json",
        `${out}/pack/${name}-${arch}.json`,
      ];
      const p = Bun.spawnSync({ cmd, stdout: "pipe", stderr: "pipe" });
      process.stdout.write(
        p.stdout
          .toString()
          .split("\n")
          .map(l => (l ? `  ${l}` : l))
          .join("\n"),
      );
      if (!p.success) throw new Error(p.stderr.toString());
    }
  }
}
