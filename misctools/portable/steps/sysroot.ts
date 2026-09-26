/**
 * The sysroot: everything that an image links against, compiled with the flags of the image (flags.ts).
 *
 *   musl        musl 1.2.5 with the host table (libc/patch_musl.ts), static only, and the headers of the
 *               Linux kernel from the machine that builds
 *   builtins    compiler-rt's builtins and crt objects, in a clang resource directory of the sysroot's own
 *   runtimes    libunwind, libc++abi, libc++, static only
 *   icu         ICU, static, with all of its data
 *   memfn       memcpy, memmove, memset, memcmp, bcmp of LLVM libc, in place of musl's
 *
 * Each step builds on the ones before it, in this order.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEMORY_FUNCTIONS,
  TREE,
  abiFlags,
  compileFlags,
  cpuFlags,
  cxxIncludeFlags,
  driverRuntimeFlags,
  hostArch,
  targetOf,
  tripleOf,
} from "../flags.ts";
import { RED_ZONE_PATCH, patchMusl } from "../libc/patch_musl.ts";
import { type Context, type Step, inOut, logOf, runStep } from "./context.ts";
import { BuildError, fetchArchive, fetchGit, run, sha256File } from "./run.ts";

/** compiler-rt's x86_64/floatundixf.S keeps a value below the stack pointer. */
const BUILTINS_PATCH = join(TREE, "patches", "llvm-compiler-rt-floatundixf-no-red-zone.diff");

/**
 * libunwind's assembly for aarch64 loads x18 when it goes to a frame, and reads and writes TPIDR2_EL0
 * before that. Both registers belong to the system that runs the image. With the patch the unwinder leaves
 * them alone: x18 has one value for the whole life of a thread, because no code of the image writes it
 * (-ffixed-x18, and the static checks), so loading it from the context of the frame would load what it
 * holds; and TPIDR2_EL0 names the buffer of the ZA state of SME, which no code of the image turns on.
 */
const UNWIND_PATCH = join(TREE, "patches", "llvm-libunwind-aarch64-host-registers.diff");

/** The patches of llvm-project, in the order in which they are applied. */
const LLVM_PATCHES = [BUILTINS_PATCH, UNWIND_PATCH];

const tool = (ctx: Context, name: string) => join(ctx.llvm, name);

/** What cmake is told in every step that runs it: the compiler, the target, the sysroot. */
export function cmakeToolchain(ctx: Context): string[] {
  const target = targetOf(ctx.arch);
  return [
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    `-DCMAKE_C_COMPILER=${tool(ctx, "clang")}`,
    `-DCMAKE_CXX_COMPILER=${tool(ctx, "clang++")}`,
    `-DCMAKE_ASM_COMPILER=${tool(ctx, "clang")}`,
    `-DCMAKE_AR=${tool(ctx, "llvm-ar")}`,
    `-DCMAKE_RANLIB=${tool(ctx, "llvm-ranlib")}`,
    `-DCMAKE_NM=${tool(ctx, "llvm-nm")}`,
    `-DCMAKE_C_COMPILER_TARGET=${target}`,
    `-DCMAKE_CXX_COMPILER_TARGET=${target}`,
    `-DCMAKE_ASM_COMPILER_TARGET=${target}`,
    "-DCMAKE_SYSTEM_NAME=Linux",
    `-DCMAKE_SYSTEM_PROCESSOR=${ctx.arch}`,
    `-DCMAKE_SYSROOT=${ctx.sysroot.root}`,
  ];
}

/** The checkout of llvm-project that builtins, runtimes and memfn compile: the pinned commit, patched. */
function llvmProject(ctx: Context): string {
  const dir = inOut(ctx, "src", "llvm-project");
  fetchGit("llvm-project", ctx.sources.llvm, dir, LLVM_PATCHES, inOut(ctx, "logs"));
  return dir;
}

const llvmInputs = (ctx: Context) => [ctx.sources.llvm.commit, ...LLVM_PATCHES.map(sha256File)];

// ───────────────────────────────────────────────────────────────────────────
// musl
// ───────────────────────────────────────────────────────────────────────────

/** Headers of the Linux kernel: they come with the machine, musl has none. */
function copyKernelHeaders(ctx: Context): void {
  const from = process.env.LINUX_HEADERS ?? "/usr/include";
  const asm = [join(from, `${ctx.arch}-linux-gnu`, "asm"), join(from, "asm")].find(dir => existsSync(dir));
  const parts: [string, string | undefined][] = [
    ["linux", join(from, "linux")],
    ["asm-generic", join(from, "asm-generic")],
    ["asm", asm],
  ];
  for (const [name, dir] of parts) {
    if (dir === undefined || !existsSync(dir)) {
      throw new BuildError(`no headers of the Linux kernel for ${ctx.arch}: ${name} is not in ${from}`, {
        hint: "set LINUX_HEADERS to a directory with linux/, asm-generic/ and asm/ (or <arch>-linux-gnu/asm/)",
      });
    }
    cpSync(dir, join(ctx.sysroot.include, name), { recursive: true, dereference: name === "asm" });
  }
}

function musl(ctx: Context): Step {
  const flags = ["-O2", ...abiFlags(ctx.arch)];
  const configure = [
    `--prefix=${join(ctx.sysroot.root, "usr")}`,
    `--syslibdir=${join(ctx.sysroot.root, "lib")}`,
    "--disable-shared",
    "--enable-static",
    `--target=${targetOf(ctx.arch)}`,
  ];
  const patch = [sha256File(join(TREE, "libc", "patch_musl.ts")), sha256File(RED_ZONE_PATCH)];
  return {
    name: "musl",
    inputs: [ctx.sources.musl.commit, patch, flags, configure, process.env.LINUX_HEADERS ?? ""],
    outputs: [
      join(ctx.sysroot.lib, "libc.a"),
      join(ctx.sysroot.lib, "rcrt1.o"),
      join(ctx.sysroot.include, "stdio.h"),
      join(ctx.sysroot.include, "linux", "futex.h"),
    ],
    make() {
      const source = inOut(ctx, "src", "musl");
      fetchGit("musl", ctx.sources.musl, source, [], inOut(ctx, "logs"), {
        identity: patch.join(),
        apply: patchMusl,
      });
      // Everything in the sysroot is built against this libc: a new libc starts a new sysroot.
      rmSync(ctx.sysroot.root, { recursive: true, force: true });
      const build = inOut(ctx, "build", "musl");
      rmSync(build, { recursive: true, force: true });
      mkdirSync(build, { recursive: true });
      const env = {
        CC: `${tool(ctx, "clang")} --target=${targetOf(ctx.arch)}`,
        AR: tool(ctx, "llvm-ar"),
        RANLIB: tool(ctx, "llvm-ranlib"),
        CFLAGS: flags.join(" "),
      };
      run([join(source, "configure"), ...configure], { cwd: build, env, log: logOf(ctx, "musl-configure") });
      run(["make", `-j${ctx.jobs}`], { cwd: build, env, log: logOf(ctx, "musl-make") });
      run(["make", "install"], { cwd: build, env, log: logOf(ctx, "musl-install") });
      copyKernelHeaders(ctx);
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// compiler-rt builtins
// ───────────────────────────────────────────────────────────────────────────

function builtins(ctx: Context, before: string): Step {
  const flags = [`-resource-dir=${ctx.sysroot.resourceDir}`, ...abiFlags(ctx.arch)].join(" ");
  const release = "-O2 -DNDEBUG";
  const options = [
    `-DCMAKE_C_FLAGS=${flags}`,
    `-DCMAKE_CXX_FLAGS=${flags}`,
    `-DCMAKE_ASM_FLAGS=${flags}`,
    `-DCMAKE_C_FLAGS_RELEASE=${release}`,
    `-DCMAKE_CXX_FLAGS_RELEASE=${release}`,
    `-DCMAKE_ASM_FLAGS_RELEASE=${release}`,
    "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY",
    "-DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON",
    "-DCOMPILER_RT_BUILD_CRT=ON",
    "-DCOMPILER_RT_BUILTINS_HIDE_SYMBOLS=ON",
    "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=ON",
    `-DCMAKE_INSTALL_PREFIX=${ctx.sysroot.resourceDir}`,
    `-DCOMPILER_RT_INSTALL_PATH=${ctx.sysroot.resourceDir}`,
  ];
  const lib = join(ctx.sysroot.resourceDir, "lib", tripleOf(ctx.arch));
  return {
    name: "builtins",
    inputs: [before, llvmInputs(ctx), options],
    outputs: [
      ctx.sysroot.builtins,
      join(lib, "clang_rt.crtbegin.o"),
      join(lib, "clang_rt.crtend.o"),
      join(ctx.sysroot.resourceDir, "include", "stddef.h"),
      join(ctx.sysroot.lib, "libclang_rt.builtins.a"),
    ],
    make() {
      const llvm = llvmProject(ctx);
      // The resource directory of the sysroot has clang's own headers and, after this step, the builtins
      // that are compiled for the image. The one of the machine's clang has builtins with a red zone.
      rmSync(ctx.sysroot.resourceDir, { recursive: true, force: true });
      mkdirSync(ctx.sysroot.resourceDir, { recursive: true });
      const machine = run([tool(ctx, "clang"), "-print-resource-dir"]).trim();
      cpSync(join(machine, "include"), join(ctx.sysroot.resourceDir, "include"), {
        recursive: true,
        dereference: true,
      });

      const build = inOut(ctx, "build", "builtins");
      rmSync(build, { recursive: true, force: true });
      run(
        [
          "cmake",
          ...cmakeToolchain(ctx),
          "-S",
          join(llvm, "compiler-rt", "lib", "builtins"),
          "-B",
          build,
          `-DLLVM_CMAKE_DIR=${join(llvm, "llvm", "cmake", "modules")}`,
          ...options,
        ],
        { log: logOf(ctx, "builtins-configure") },
      );
      run(["ninja", "-C", build, `-j${ctx.jobs}`], { log: logOf(ctx, "builtins-build") });
      run(["ninja", "-C", build, "install"], { log: logOf(ctx, "builtins-install") });
      // __emutls_get_address is the libc's (bun_emutls.c). The one of compiler-rt takes its memory from
      // malloc, and a link through the clang driver puts the builtins in front of the libc.
      run([tool(ctx, "llvm-ar"), "d", ctx.sysroot.builtins, "emutls.c.o"]);
      // A copy for a link that names the sysroot only: -lclang_rt.builtins.
      cpSync(ctx.sysroot.builtins, join(ctx.sysroot.lib, "libclang_rt.builtins.a"));
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// libunwind, libc++abi, libc++
// ───────────────────────────────────────────────────────────────────────────

function runtimes(ctx: Context, before: string): Step {
  const flags = [`-resource-dir=${ctx.sysroot.resourceDir}`, ...abiFlags(ctx.arch)].join(" ");
  const options = [
    "-DLLVM_ENABLE_RUNTIMES=libunwind;libcxxabi;libcxx",
    `-DCMAKE_C_FLAGS=${flags}`,
    `-DCMAKE_CXX_FLAGS=${flags}`,
    `-DCMAKE_ASM_FLAGS=${flags}`,
    "-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=lld -rtlib=compiler-rt -unwindlib=none -nostdlib++ -static-pie",
    `-DCMAKE_INSTALL_PREFIX=${join(ctx.sysroot.root, "usr")}`,
    "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF",
    "-DLLVM_INCLUDE_TESTS=OFF",
    "-DLLVM_INCLUDE_DOCS=OFF",
    "-DLIBUNWIND_ENABLE_SHARED=OFF",
    "-DLIBUNWIND_ENABLE_STATIC=ON",
    "-DLIBUNWIND_USE_COMPILER_RT=ON",
    "-DLIBUNWIND_INCLUDE_TESTS=OFF",
    "-DLIBUNWIND_INCLUDE_DOCS=OFF",
    "-DLIBCXXABI_ENABLE_SHARED=OFF",
    "-DLIBCXXABI_ENABLE_STATIC=ON",
    "-DLIBCXXABI_USE_COMPILER_RT=ON",
    "-DLIBCXXABI_USE_LLVM_UNWINDER=ON",
    "-DLIBCXXABI_ENABLE_STATIC_UNWINDER=ON",
    "-DLIBCXXABI_INCLUDE_TESTS=OFF",
    "-DLIBCXX_ENABLE_SHARED=OFF",
    "-DLIBCXX_ENABLE_STATIC=ON",
    "-DLIBCXX_USE_COMPILER_RT=ON",
    "-DLIBCXX_HAS_MUSL_LIBC=ON",
    "-DLIBCXX_CXX_ABI=libcxxabi",
    "-DLIBCXX_ENABLE_STATIC_ABI_LIBRARY=ON",
    "-DLIBCXX_INCLUDE_TESTS=OFF",
    "-DLIBCXX_INCLUDE_BENCHMARKS=OFF",
    "-DLIBCXX_INCLUDE_DOCS=OFF",
  ];
  return {
    name: "runtimes",
    inputs: [before, llvmInputs(ctx), options],
    outputs: [
      join(ctx.sysroot.lib, "libc++.a"),
      join(ctx.sysroot.lib, "libc++abi.a"),
      join(ctx.sysroot.lib, "libunwind.a"),
      join(ctx.sysroot.include, "c++", "v1", "vector"),
    ],
    make() {
      const llvm = llvmProject(ctx);
      const build = inOut(ctx, "build", "runtimes");
      rmSync(build, { recursive: true, force: true });
      // The build of libc++ runs Python scripts of the checkout. Python must not leave its caches there.
      const env = { PYTHONDONTWRITEBYTECODE: "1" };
      run(["cmake", ...cmakeToolchain(ctx), "-S", join(llvm, "runtimes"), "-B", build, ...options], {
        env,
        log: logOf(ctx, "runtimes-configure"),
      });
      run(["ninja", "-C", build, `-j${ctx.jobs}`], { env, log: logOf(ctx, "runtimes-build") });
      run(["ninja", "-C", build, "install"], { env, log: logOf(ctx, "runtimes-install") });
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ICU
// ───────────────────────────────────────────────────────────────────────────

function icu(ctx: Context, before: string): Step {
  // Optimisation and sections as in the ICU of oven-sh/WebKit's own musl build.
  const common = [
    "-Os",
    ...cpuFlags(ctx.arch),
    "-ffunction-sections",
    "-fdata-sections",
    "-fno-unwind-tables",
    "-fno-asynchronous-unwind-tables",
    "-DU_STATIC_IMPLEMENTATION=1",
  ];
  const cxx = ["-fno-exceptions", "-fno-c++-static-destructors"];
  const image = compileFlags(ctx.arch, ctx.sysroot);
  const configure = [
    `--prefix=${join(ctx.sysroot.root, "usr")}`,
    "--enable-static",
    "--disable-shared",
    "--with-data-packaging=static",
    "--disable-samples",
    "--disable-debug",
    "--disable-tests",
    "--disable-extras",
    "--disable-icuio",
    "--disable-layoutex",
  ];
  const tools = { AR: tool(ctx, "llvm-ar"), RANLIB: tool(ctx, "llvm-ranlib") };
  const cross = ctx.arch !== hostArch();
  return {
    name: "icu",
    inputs: [before, ctx.sources.icu.sha256, common, cxx, configure, cross],
    outputs: [
      join(ctx.sysroot.lib, "libicuuc.a"),
      join(ctx.sysroot.lib, "libicui18n.a"),
      join(ctx.sysroot.lib, "libicudata.a"),
      join(ctx.sysroot.include, "unicode", "utypes.h"),
    ],
    async make() {
      const archive = inOut(ctx, "src", `icu4c-${ctx.sources.icu.tag}.tgz`);
      await fetchArchive("icu", ctx.sources.icu, archive);
      const source = inOut(ctx, "src", "icu");
      rmSync(source, { recursive: true, force: true });
      run(["tar", "-xzf", archive, "-C", inOut(ctx, "src")], { log: logOf(ctx, "icu-extract") });
      const configureScript = join(source, "source", "configure");

      // ICU builds its data with tools that it compiles first. For an image of this machine's
      // architecture they are images themselves and run here. For another architecture ICU wants a
      // build for this machine next to it, and takes the tools from there.
      const crossOptions: string[] = [];
      if (cross) {
        const native = inOut(ctx, "build", "icu-native");
        rmSync(native, { recursive: true, force: true });
        mkdirSync(native, { recursive: true });
        const env = { CC: tool(ctx, "clang"), CXX: tool(ctx, "clang++"), CFLAGS: "-O2", CXXFLAGS: "-O2", ...tools };
        run(
          [
            configureScript,
            "--enable-static",
            "--disable-shared",
            "--disable-samples",
            "--disable-tests",
            "--disable-extras",
          ],
          {
            cwd: native,
            env,
            log: logOf(ctx, "icu-native-configure"),
          },
        );
        run(["make", `-j${ctx.jobs}`], { cwd: native, env, log: logOf(ctx, "icu-native-make") });
        crossOptions.push(`--host=${targetOf(ctx.arch)}`, `--with-cross-build=${native}`);
      }

      const build = inOut(ctx, "build", "icu");
      rmSync(build, { recursive: true, force: true });
      mkdirSync(build, { recursive: true });
      const env = {
        CC: tool(ctx, "clang"),
        CXX: tool(ctx, "clang++"),
        CFLAGS: [...image, ...common].join(" "),
        CXXFLAGS: [...image, ...cxxIncludeFlags(ctx.sysroot), "-stdlib=libc++", ...common, ...cxx].join(" "),
        LDFLAGS: [...image, ...driverRuntimeFlags(), "-stdlib=libc++"].join(" "),
        ...tools,
      };
      run([configureScript, ...configure, ...crossOptions], { cwd: build, env, log: logOf(ctx, "icu-configure") });
      run(["make", `-j${ctx.jobs}`], { cwd: build, env, log: logOf(ctx, "icu-make") });
      run(["make", "install"], { cwd: build, env, log: logOf(ctx, "icu-install") });
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Memory functions
// ───────────────────────────────────────────────────────────────────────────

/**
 * musl's memcpy, memmove and memset are `rep movs` and `rep stos` loops, its memcmp compares byte by byte.
 * The ones of LLVM libc are chosen at compile time for the oldest CPU that bun runs on: no dispatch at
 * run time, so no ifunc, which a static image could not resolve.
 */
function memfn(ctx: Context, before: string): Step {
  const flags = [
    ...cpuFlags(ctx.arch),
    "-O3",
    "-DNDEBUG",
    "-std=c++20",
    "-fno-exceptions",
    "-fno-rtti",
    "-fno-unwind-tables",
    "-fno-asynchronous-unwind-tables",
    "-ffunction-sections",
    "-fdata-sections",
    // The compiler must not turn the body of memcpy into a call of memcpy.
    "-ffreestanding",
    "-fno-builtin",
    // LLVM libc as a source library: a namespace of its own, the public C names as aliases of its functions.
    "-DLIBC_NAMESPACE=__llvm_libc_bun_portable",
    "-DLIBC_COPT_PUBLIC_PACKAGING",
  ];
  return {
    name: "memfn",
    inputs: [before, llvmInputs(ctx), flags, MEMORY_FUNCTIONS],
    outputs: MEMORY_FUNCTIONS.map(name => join(ctx.sysroot.memfn, `${name}.o`)),
    make() {
      const libc = join(llvmProject(ctx), "libc");
      rmSync(ctx.sysroot.memfn, { recursive: true, force: true });
      mkdirSync(ctx.sysroot.memfn, { recursive: true });
      for (const name of MEMORY_FUNCTIONS) {
        // bcmp is in src/strings in newer trees.
        const candidates = [join(libc, "src", "string", `${name}.cpp`), join(libc, "src", "strings", `${name}.cpp`)];
        const source = candidates.find(path => existsSync(path));
        if (source === undefined) throw new BuildError(`no source for ${name}: ${candidates.join(", ")}`);
        run([
          tool(ctx, "clang++"),
          ...compileFlags(ctx.arch, ctx.sysroot),
          ...cxxIncludeFlags(ctx.sysroot),
          ...flags,
          `-I${libc}`,
          "-c",
          source,
          "-o",
          join(ctx.sysroot.memfn, `${name}.o`),
        ]);
      }
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The commands
// ───────────────────────────────────────────────────────────────────────────

/** A clang configuration file: `clang --config=<sysroot>/portable.cfg x.c` compiles for the image. */
function writeConfigFile(ctx: Context): void {
  const lines = [
    `# clang configuration file of the portable image (${ctx.arch}). Written by misctools/portable/build.ts.`,
    "#   clang   --config=<this file> file.c",
    "#   clang++ --config=<this file> file.cpp",
    "# Link: add -static-pie",
    `--target=${targetOf(ctx.arch)}`,
    "--sysroot=<CFGDIR>",
    "-resource-dir=<CFGDIR>/clang-resource-dir",
    "-stdlib++-isystem <CFGDIR>/usr/include/c++/v1",
    ...abiFlags(ctx.arch),
    "-stdlib=libc++",
    ...driverRuntimeFlags().filter(flag => flag !== "-static-pie"),
  ];
  writeFileSync(join(ctx.sysroot.root, "portable.cfg"), lines.join("\n") + "\n");
}

/** The libc and the builtins: what a C program links against. Returns the identity of the two. */
export async function buildLibc(ctx: Context): Promise<string> {
  const libc = await runStep(ctx, musl(ctx));
  return await runStep(ctx, builtins(ctx, libc));
}

/** Every step, in order. */
export async function buildSysroot(ctx: Context): Promise<string> {
  let identity = await buildLibc(ctx);
  identity = await runStep(ctx, runtimes(ctx, identity));
  identity = await runStep(ctx, icu(ctx, identity));
  identity = await runStep(ctx, memfn(ctx, identity));
  writeConfigFile(ctx);
  const libraries = readdirSync(ctx.sysroot.lib).filter(name => name.endsWith(".a"));
  console.log(`sysroot: ${ctx.sysroot.root} (${libraries.sort().join(" ")})`);
  return identity;
}
