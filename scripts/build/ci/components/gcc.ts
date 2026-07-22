// The pinned GCC toolchain and the compiler environment that binds the build
// to clang + gcc's libstdc++. Ubuntu images ship gcc-<version> from the
// ubuntu-toolchain-r/test PPA plus the sanitizer runtimes; the login
// environment then points CC/CXX at the pinned clang and the include/library
// search paths at the gcc toolchain, and /usr/bin gets stable names
// (clang, clang++, lld, cc, c++, ...). Images without a `gcc` fact skip it —
// on Debian and Alpine the distro's own compiler set is what the build uses.

import { basename } from "node:path";
import { ensureLines, log, mode, run, sudo, which } from "../bootstrap/runtime.ts";
import { ensureDirectory, ensureSymlink } from "../bootstrap/ops-posix.ts";
import type { Component, LinuxContext } from "./component.ts";
import { appendToProfiles } from "./environment.ts";
import { installPackages } from "./system-linux.ts";

/** The GNU triplet gcc keys its toolchain directories by. */
function gnuTriplet(arch: "x64" | "aarch64"): string {
  return arch === "aarch64" ? "aarch64-linux-gnu" : "x86_64-linux-gnu";
}

/** Resolve a versioned LLVM binary and symlink an unversioned name to it. The
 * lookup is a bake-time fact — on a real image llvm has just run, so a miss
 * is a broken ordering and fails loudly. A dry run is not on the bake host,
 * so it records the intent against the nominal versioned name instead. */
async function linkLlvmTool(versioned: string, at: string): Promise<void> {
  const found = which(versioned);
  if (found === undefined && !mode.dryRun) {
    throw new Error(`gcc: ${versioned} not on PATH; the llvm component must run before gcc`);
  }
  await ensureSymlink(found ?? versioned, at);
}

export const gcc: Component = {
  name: "gcc",
  linux: {
    artifacts: () => ({}),
    steps: ctx => {
      const { image } = ctx;
      const spec = image.gcc;
      return [
        {
          name: spec === null ? "Install pinned GCC toolchain" : `Install GCC ${spec.version} toolchain (PPA, sanitizers, compiler env)`,
          skip: spec === null && "no pinned gcc on this image (distro compiler set is used)",
          run: () => installGcc(ctx, spec!.version),
        },
      ];
    },
  },
};

async function installGcc(ctx: LinuxContext, version: string): Promise<void> {
  const { image } = ctx;
  const triplet = gnuTriplet(image.arch);
  const llvm = String(image.llvm.major);

  await sudo(["add-apt-repository", "-y", "ppa:ubuntu-toolchain-r/test"]);
  await sudo(["apt-get", "update", "-y"], { env: { DEBIAN_FRONTEND: "noninteractive" } });
  await installPackages(ctx, [
    `gcc-${version}`,
    `g++-${version}`,
    `libgcc-${version}-dev`,
    `libstdc++-${version}-dev`,
    "libasan6",
    "libubsan1",
    "libatomic1",
    "libtsan0",
    "liblsan0",
    "libgfortran5",
    "libc6-dev",
  ]);

  await sudo([
    "update-alternatives",
    "--install",
    "/usr/bin/gcc",
    "gcc",
    `/usr/bin/gcc-${version}`,
    "130",
    "--slave",
    "/usr/bin/g++",
    "g++",
    `/usr/bin/g++-${version}`,
    "--slave",
    "/usr/bin/gcc-ar",
    "gcc-ar",
    `/usr/bin/gcc-ar-${version}`,
    "--slave",
    "/usr/bin/gcc-nm",
    "gcc-nm",
    `/usr/bin/gcc-nm-${version}`,
    "--slave",
    "/usr/bin/gcc-ranlib",
    "gcc-ranlib",
    `/usr/bin/gcc-ranlib-${version}`,
  ]);

  // The compiler environment: build with the pinned clang, resolve headers
  // and libraries against this gcc's libstdc++/libgcc.
  const gccLibDir = `/usr/lib/gcc/${triplet}/${version}`;
  await appendToProfiles(ctx, [
    `export CC=clang-${llvm}`,
    `export CXX=clang++-${llvm}`,
    `export AR=llvm-ar-${llvm}`,
    `export RANLIB=llvm-ranlib-${llvm}`,
    `export LD=lld-${llvm}`,
    `export LD_LIBRARY_PATH=${gccLibDir}:/usr/lib/${triplet}`,
    `export LIBRARY_PATH=${gccLibDir}:/usr/lib/${triplet}`,
    `export CPLUS_INCLUDE_PATH=/usr/include/c++/${version}:/usr/include/${triplet}/c++/${version}`,
    `export C_INCLUDE_PATH=${gccLibDir}/include`,
  ]);

  // libstdc++ where the loader and the toolchain both look.
  await ensureDirectory(gccLibDir, { mode: "0755" });
  await ensureSymlink(`/usr/lib/${triplet}/libstdc++.so.6`, `${gccLibDir}/libstdc++.so.6`);
  const ldConf = `/etc/ld.so.conf.d/gcc-${version}.conf`;
  await ensureLines(ldConf, [gccLibDir, `/usr/lib/${triplet}`]);
  await sudo(["ldconfig"]);

  // Stable /usr/bin names bound to the pinned LLVM tools.
  const tools: [string, string][] = [
    [`clang-${llvm}`, "/usr/bin/clang"],
    [`clang++-${llvm}`, "/usr/bin/clang++"],
    [`lld-${llvm}`, "/usr/bin/lld"],
    [`lldb-${llvm}`, "/usr/bin/lldb"],
    [`clangd-${llvm}`, "/usr/bin/clangd"],
    [`llvm-ar-${llvm}`, "/usr/bin/llvm-ar"],
    [`ld.lld-${llvm}`, "/usr/bin/ld"],
  ];
  for (const [versioned, at] of tools) await linkLlvmTool(versioned, at);
  await ensureSymlink("/usr/bin/clang", "/usr/bin/cc");
  await ensureSymlink("/usr/bin/clang++", "/usr/bin/c++");

  const gccPath = which("gcc");
  log(`gcc: ${gccPath !== undefined ? basename(gccPath) : "gcc"} -> ${version}; CC=clang-${llvm}; toolchain ${gccLibDir}`);
  await run(["gcc", "--version"], { allowFailure: false });
}
