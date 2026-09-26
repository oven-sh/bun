// Builds the portable image of JavaScriptCore's "jsc" shell for aarch64, from sources:
// the sysroot of the image ABI first, then WebKit, then the image.
//
//   bun jsc/build-aarch64.ts [step]...   steps, in this order:
//                                        musl builtins runtimes icu memfn mimalloc webkit link check small
//                                        no step: all of them. A step whose result exists is
//                                        skipped, except when it is named.
//
// The image ABI for aarch64: --target=aarch64-linux-musl, static-pie, emulated TLS, x18 is
// never written (it is the TEB on Windows and reserved on macOS), no stack protector,
// segments aligned to 64 KiB. Atomics are outline (the helpers of compiler-rt choose LSE or
// LL/SC from AT_HWCAP when the image starts), the processor is bun's floor for arm64.
//
// Sources, under SOURCES (default: <WORK>/cache). Each is a checkout that this script reads,
// and patches where it says so:
//   musl-pristine   musl 1.2.5, cloned and patched by libc/patch_musl.py
//   llvm-project    the commit of the clang in use: compiler-rt, libunwind, libcxxabi, libcxx, libc
//   icu4c-78.3-sources.tgz
//   mimalloc-bun    bun's vendor/mimalloc
//   WebKit          bun's fork at the commit of scripts/build/deps/webkit.ts
// Results, under WORK (default: the directory above this tree):
//   sysroot-aarch64/              the sysroot
//   build/aarch64/                build trees and logs
//   out/aarch64/jsc.img, .map, .json      the image, signed for Apple Silicon as its last step
//   <tree>/out/aarch64/ (or SMALL)        step small: the test images of build.sh and the Linux
//                                         test host, linked against the libc of THIS sysroot.
//                                         build.sh by itself builds a libc without the two
//                                         files for a JIT, and requests.img then runs the
//                                         cache instructions itself on every system. These
//                                         are the images for Windows and macOS. The test
//                                         host is copied to out/aarch64/host-linux.
// JSC_VARIANT=x18-allocatable builds WebKit WITHOUT the definition that reserves x18, into
// its own build tree and out/aarch64/jsc.x18-allocatable.img: the negative control of the
// x18 tests. Never run that image under a host that keeps something in x18.
// JSC_VARIANT=jit-permissions builds WebKit with jsc/bun_jit_permissions.h in front of every
// file: JavaScriptCore says itself when a thread writes code and when it runs it, where the
// host asks for that (Apple Silicon). out/aarch64/jsc.jit-permissions.img. It is the other
// way next to the faults of the macOS host, built to be measured.
// Other environment: LLVM_BIN, JOBS (8).
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, statSync, copyFileSync, lstatSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const tree = resolve(dirname(import.meta.path), "..");
const work = resolve(process.env.WORK ?? join(tree, ".."));
const sources = resolve(process.env.SOURCES ?? join(work, "cache"));
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const jobs = process.env.JOBS ?? "8";
const variant = process.env.JSC_VARIANT ?? "";
if (!["", "x18-allocatable", "jit-permissions"].includes(variant)) throw new Error(`JSC_VARIANT: "", "x18-allocatable" or "jit-permissions"`);

const target = "aarch64-linux-musl";
const runtimeDir = "aarch64-unknown-linux-musl";
export const abiFlags = ["-femulated-tls", "-ffixed-x18", "-fno-stack-protector", "-fPIE", "-moutline-atomics"];
export const cpuFlags = ["-march=armv8-a+crc"];
// The one definition that makes JavaScriptCore keep x18 free, see patchWebKit().
export const reserveX18 = "-DJSC_ARM64_RESERVE_X18=1";

const sysroot = join(work, "sysroot-aarch64");
const resource = join(sysroot, "clang-resource-dir");
const build = join(work, "build/aarch64");
const logs = join(build, "logs");
const out = join(work, "out/aarch64");
const suffix = variant ? `.${variant}` : "";
const image = process.env.IMAGE ?? join(out, `jsc${suffix}.img`);
const small = resolve(process.env.SMALL ?? join(tree, "out/aarch64"));
const webkitBuild = join(build, `webkit${suffix}`);
const llvmSource = join(sources, "llvm-project");
const webkitSource = join(sources, "WebKit");

const toolchain = [`--target=${target}`, `--sysroot=${sysroot}`, `-resource-dir=${resource}`];
const cxxLibrary = ["-stdlib++-isystem", join(sysroot, "usr/include/c++/v1"), "-stdlib=libc++"];
const linkLibraries = ["-fuse-ld=lld", "-rtlib=compiler-rt", "-unwindlib=libunwind"];
const ccache = { CCACHE_DIR: join(sources, "ccache") };

function run(cmd: string[], options: { cwd?: string; env?: Record<string, string>; log?: string } = {}) {
  console.log(`+ ${cmd.join(" ")}${options.cwd ? `   (in ${options.cwd})` : ""}`);
  const started = Date.now();
  mkdirSync(logs, { recursive: true });
  const log = options.log ? join(logs, options.log) : undefined;
  const result = Bun.spawnSync(cmd, {
    cwd: options.cwd,
    env: { ...process.env, ...ccache, ...options.env },
    stdout: log ? Bun.file(log) : "inherit",
    stderr: log ? Bun.file(`${log}.err`) : "inherit",
  });
  if (log) console.log(`  ${((Date.now() - started) / 1000).toFixed(0)} s, log: ${log}`);
  if (result.exitCode !== 0) {
    if (log) for (const f of [log, `${log}.err`]) console.error(readFileSync(f, "utf8").split("\n").slice(-40).join("\n"));
    throw new Error(`exit code ${result.exitCode}: ${cmd[0]}`);
  }
}
function capture(cmd: string[]): string {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`exit code ${result.exitCode}: ${cmd.join(" ")}\n${result.stderr}`);
  return result.stdout.toString();
}
// A patch is a replacement of text that has to be there exactly once. Applied twice it does nothing.
function patch(file: string, from: string, to: string) {
  const text = readFileSync(file, "utf8");
  if (text.includes(to)) return;
  if (text.split(from).length !== 2) throw new Error(`${file}: the text to patch is there ${text.split(from).length - 1} times`);
  writeFileSync(file, text.replace(from, to));
  console.log(`patched ${file}`);
}
const cmakeCross = (flags: string[]) => [
  "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
  `-DCMAKE_C_COMPILER=${llvm}/clang`, `-DCMAKE_CXX_COMPILER=${llvm}/clang++`, `-DCMAKE_ASM_COMPILER=${llvm}/clang`,
  `-DCMAKE_AR=${llvm}/llvm-ar`, `-DCMAKE_RANLIB=${llvm}/llvm-ranlib`, `-DCMAKE_NM=${llvm}/llvm-nm`,
  `-DCMAKE_C_COMPILER_TARGET=${target}`, `-DCMAKE_CXX_COMPILER_TARGET=${target}`, `-DCMAKE_ASM_COMPILER_TARGET=${target}`,
  "-DCMAKE_SYSTEM_NAME=Linux", "-DCMAKE_SYSTEM_PROCESSOR=aarch64", `-DCMAKE_SYSROOT=${sysroot}`,
  `-DCMAKE_C_FLAGS=${flags.join(" ")}`, `-DCMAKE_CXX_FLAGS=${flags.join(" ")}`, `-DCMAKE_ASM_FLAGS=${flags.join(" ")}`,
];
const fresh = (dir: string) => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
};

// WebKit keeps x18 free where the platform owns it (Darwin, Windows) with the third column
// of its list of registers, and has a second list for Linux and FreeBSD where x18 is a
// register like the others. The image is Linux inside and runs on all of them, so its build
// takes the first list. One line of the source asks for the definition, nothing else changes.
export function patchWebKit() {
  patch(
    join(webkitSource, "Source/JavaScriptCore/assembler/ARM64Registers.h"),
    "#if OS(LINUX) || OS(FREEBSD)\n#define FOR_EACH_GP_REGISTER(macro)",
    "#if (OS(LINUX) || OS(FREEBSD)) && !defined(JSC_ARM64_RESERVE_X18)\n#define FOR_EACH_GP_REGISTER(macro)",
  );
  // The shell links the allocator that bun links, built outside of WebKit's tree.
  patch(
    join(webkitSource, "Source/JavaScriptCore/shell/CMakeLists.txt"),
    "    list(APPEND jsc_LIBRARIES $<TARGET_OBJECTS:mimalloc-obj>)\n",
    "    if (PORTABLE_MIMALLOC_OBJECT)\n        list(APPEND jsc_LIBRARIES ${PORTABLE_MIMALLOC_OBJECT})\n    else ()\n        list(APPEND jsc_LIBRARIES $<TARGET_OBJECTS:mimalloc-obj>)\n    endif ()\n",
  );
}

const steps: Record<string, { done: () => boolean; make: () => void }> = {
  musl: {
    done: () => existsSync(join(sysroot, "usr/lib/libc.a")),
    make() {
      const source = fresh(join(build, "musl-src"));
      const dir = fresh(join(build, "musl"));
      run(["git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", "v1.2.5", `file://${join(sources, "musl-pristine")}`, source]);
      run(["python3", join(tree, "libc/patch_musl.py"), source]);
      // What an image with a JIT needs on top of that patch: see the files.
      for (const file of ["bun_clear_cache.c", "bun_jit_permission.c"]) copyFileSync(join(tree, "libc", file), join(source, "src/thread/aarch64", file));
      // The flags of the libc that build.sh makes for aarch64, which is the one that ran on
      // the three systems, and the flags of the image ABI that mean nothing for C without
      // thread locals and without atomics of the compiler.
      const env = { CC: `${llvm}/clang --target=${target}`, AR: `${llvm}/llvm-ar`, RANLIB: `${llvm}/llvm-ranlib`, CFLAGS: ["-O2", ...abiFlags].join(" ") };
      run([join(source, "configure"), `--prefix=${sysroot}/usr`, `--syslibdir=${sysroot}/lib`, "--disable-shared", "--enable-static", `--target=${target}`], { cwd: dir, env, log: "musl-configure.log" });
      run(["make", `-j${jobs}`], { cwd: dir, env, log: "musl-make.log" });
      run(["make", "install"], { cwd: dir, env, log: "musl-install.log" });
      // The headers of the Linux kernel, from this machine.
      for (const [from, to] of [["/usr/include/linux", "linux"], ["/usr/include/asm-generic", "asm-generic"], ["/usr/include/aarch64-linux-gnu/asm", "asm"]]) {
        rmSync(join(sysroot, "usr/include", to), { recursive: true, force: true });
        run(["cp", "-aL", from, join(sysroot, "usr/include", to)]);
      }
    },
  },

  builtins: {
    done: () => existsSync(join(resource, "lib", runtimeDir, "libclang_rt.builtins.a")),
    make() {
      // A resource directory of its own: the one of the machine has builtins for another
      // libc and another processor.
      rmSync(resource, { recursive: true, force: true });
      mkdirSync(resource, { recursive: true });
      run(["cp", "-aL", join(capture([`${llvm}/clang`, "-print-resource-dir"]).trim(), "include"), join(resource, "include")]);
      const dir = fresh(join(build, "builtins"));
      run(["cmake", "-S", join(llvmSource, "compiler-rt/lib/builtins"), "-B", dir, ...cmakeCross([...abiFlags, ...cpuFlags]),
        "-DCMAKE_C_FLAGS_RELEASE=-O2 -DNDEBUG", "-DCMAKE_CXX_FLAGS_RELEASE=-O2 -DNDEBUG", "-DCMAKE_ASM_FLAGS_RELEASE=-O2 -DNDEBUG",
        "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY", "-DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON", "-DCOMPILER_RT_BUILD_CRT=ON",
        "-DCOMPILER_RT_BUILTINS_HIDE_SYMBOLS=ON", "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=ON",
        `-DLLVM_CMAKE_DIR=${join(llvmSource, "llvm/cmake/modules")}`, `-DCMAKE_INSTALL_PREFIX=${resource}`, `-DCOMPILER_RT_INSTALL_PATH=${resource}`,
      ], { log: "builtins-configure.log" });
      run(["ninja", "-C", dir, `-j${jobs}`], { log: "builtins-build.log" });
      run(["ninja", "-C", dir, "install"], { log: "builtins-install.log" });
      const archive = join(resource, "lib", runtimeDir, "libclang_rt.builtins.a");
      // __emutls_get_address is the one of the libc (bun_emutls.c), and so is __clear_cache
      // (bun_clear_cache.c): with the driver of clang the builtins come before -lc.
      run([`${llvm}/llvm-ar`, "d", archive, "emutls.c.o", "clear_cache.c.o"]);
      copyFileSync(archive, join(sysroot, "usr/lib/libclang_rt.builtins.a"));
    },
  },

  runtimes: {
    done: () => existsSync(join(sysroot, "usr/lib/libc++.a")),
    make() {
      // The jump that ends an unwind loads every register that the thread had, x18 too. It
      // is the value that the same thread saved, so nothing changes, and still: no write.
      patch(join(llvmSource, "libunwind/src/UnwindRegistersRestore.S"), "  ldp    x18,x19, [x0, #0x090]\n", "  ldr    x19,     [x0, #0x098]\n");
      const dir = fresh(join(build, "runtimes"));
      run(["cmake", "-S", join(llvmSource, "runtimes"), "-B", dir, ...cmakeCross([...abiFlags, ...cpuFlags, `-resource-dir=${resource}`]),
        "-DLLVM_ENABLE_RUNTIMES=libunwind;libcxxabi;libcxx",
        `-DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=lld -rtlib=compiler-rt -unwindlib=none -nostdlib++ -static-pie`,
        `-DCMAKE_INSTALL_PREFIX=${sysroot}/usr`, "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF", "-DLLVM_INCLUDE_TESTS=OFF", "-DLLVM_INCLUDE_DOCS=OFF",
        "-DLIBUNWIND_ENABLE_SHARED=OFF", "-DLIBUNWIND_ENABLE_STATIC=ON", "-DLIBUNWIND_USE_COMPILER_RT=ON", "-DLIBUNWIND_INCLUDE_TESTS=OFF", "-DLIBUNWIND_INCLUDE_DOCS=OFF",
        "-DLIBCXXABI_ENABLE_SHARED=OFF", "-DLIBCXXABI_ENABLE_STATIC=ON", "-DLIBCXXABI_USE_COMPILER_RT=ON", "-DLIBCXXABI_USE_LLVM_UNWINDER=ON",
        "-DLIBCXXABI_ENABLE_STATIC_UNWINDER=ON", "-DLIBCXXABI_INCLUDE_TESTS=OFF",
        "-DLIBCXX_ENABLE_SHARED=OFF", "-DLIBCXX_ENABLE_STATIC=ON", "-DLIBCXX_USE_COMPILER_RT=ON", "-DLIBCXX_HAS_MUSL_LIBC=ON", "-DLIBCXX_CXX_ABI=libcxxabi",
        "-DLIBCXX_ENABLE_STATIC_ABI_LIBRARY=ON", "-DLIBCXX_INCLUDE_TESTS=OFF", "-DLIBCXX_INCLUDE_BENCHMARKS=OFF", "-DLIBCXX_INCLUDE_DOCS=OFF",
      ], { log: "runtimes-configure.log" });
      run(["ninja", "-C", dir, `-j${jobs}`], { log: "runtimes-build.log" });
      run(["ninja", "-C", dir, "install"], { log: "runtimes-install.log" });
    },
  },

  icu: {
    done: () => existsSync(join(sysroot, "usr/lib/libicuuc.a")),
    make() {
      // ICU builds its data with tools of its own, which have to run here: they come from
      // a build for this machine, and the build for the image is a cross build.
      const source = fresh(join(build, "icu-src"));
      run(["tar", "-xzf", join(sources, "icu4c-78.3-sources.tgz"), "-C", source]);
      const configure = join(source, "icu/source/configure");
      const options = ["--enable-static", "--disable-shared", "--with-data-packaging=static", "--disable-samples", "--disable-debug", "--disable-tests", "--disable-extras", "--disable-icuio", "--disable-layoutex"];
      const native = fresh(join(build, "icu-native"));
      const tools = { CC: `${llvm}/clang`, CXX: `${llvm}/clang++`, AR: `${llvm}/llvm-ar`, RANLIB: `${llvm}/llvm-ranlib` };
      run([configure, ...options], { cwd: native, env: { ...tools, CFLAGS: "-O2", CXXFLAGS: "-O2", LDFLAGS: "-fuse-ld=lld" }, log: "icu-native-configure.log" });
      run(["make", `-j${jobs}`], { cwd: native, env: tools, log: "icu-native-make.log" });
      // The flags of the x86-64 image (-Os, sections, no unwind tables), with its ABI.
      const common = ["-Os", ...cpuFlags, "-ffunction-sections", "-fdata-sections", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-DU_STATIC_IMPLEMENTATION=1"];
      const env = {
        ...tools,
        CFLAGS: [...toolchain, ...abiFlags, ...common].join(" "),
        CXXFLAGS: [...toolchain, ...abiFlags, ...cxxLibrary, ...common, "-fno-exceptions", "-fno-c++-static-destructors"].join(" "),
        LDFLAGS: [...toolchain, ...abiFlags, ...linkLibraries, "-stdlib=libc++", "-static-pie"].join(" "),
      };
      const dir = fresh(join(build, "icu"));
      run([configure, `--prefix=${sysroot}/usr`, `--host=${target}`, `--with-cross-build=${native}`, ...options], { cwd: dir, env, log: "icu-configure.log" });
      run(["make", `-j${jobs}`], { cwd: dir, env, log: "icu-make.log" });
      run(["make", "install"], { cwd: dir, env, log: "icu-install.log" });
    },
  },

  memfn: {
    done: () => existsSync(join(sysroot, "usr/lib/portable-memfn/bcmp.o")),
    make() {
      // memcpy, memmove, memset, memcmp, bcmp of LLVM libc, in front of the ones of musl. For
      // aarch64 they are chosen when they are compiled, with one question at run time: memset
      // reads DCZID_EL0 (a register that code outside of the kernel may read) before it
      // clears a block with "dc zva".
      const dir = fresh(join(sysroot, "usr/lib/portable-memfn"));
      const flags = [
        ...toolchain, ...cxxLibrary, ...abiFlags, ...cpuFlags, "-O3", "-DNDEBUG", "-std=c++20", "-fno-exceptions", "-fno-rtti",
        "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-ffunction-sections", "-fdata-sections",
        // The compiler must not turn the body of memcpy into a call of memcpy.
        "-ffreestanding", "-fno-builtin",
        // LLVM libc as a library of sources: a namespace of its own, and the C names as aliases.
        `-I${join(llvmSource, "libc")}`, "-DLIBC_NAMESPACE=__llvm_libc_bun_portable", "-DLIBC_COPT_PUBLIC_PACKAGING",
      ];
      for (const name of ["memcpy", "memmove", "memset", "memcmp", "bcmp"]) {
        const source = [join(llvmSource, "libc/src/string", `${name}.cpp`), join(llvmSource, "libc/src/strings", `${name}.cpp`)].find(existsSync);
        if (!source) throw new Error(`no source for ${name}`);
        run([`${llvm}/clang++`, ...flags, "-c", source, "-o", join(dir, `${name}.o`)]);
      }
      writeFileSync(join(dir, "FLAGS.txt"), flags.join(" ") + "\n");
    },
  },

  mimalloc: {
    done: () => existsSync(join(build, "mimalloc/mimalloc.o")),
    make() {
      // bun's flags for mimalloc in a release build, as for the x86-64 image: the thread
      // locals of the compiler (emulated TLS here), and the thread id is pthread_self(),
      // because what mimalloc does by itself with musl is to read the thread register.
      const dir = fresh(join(build, "mimalloc"));
      const flags = [
        "-x", "c++", "-std=c++20", ...toolchain, ...cxxLibrary, ...abiFlags, ...cpuFlags,
        "-O3", "-DNDEBUG", "-fno-exceptions", "-fno-rtti", "-fno-c++-static-destructors", "-fno-omit-frame-pointer",
        "-mno-omit-leaf-frame-pointer", "-fvisibility=hidden", "-fvisibility-inlines-hidden", "-fno-unwind-tables",
        "-fno-asynchronous-unwind-tables", "-ffunction-sections", "-fdata-sections", "-faddrsig", "-fno-semantic-interposition",
        "-DMI_STATIC_LIB", "-DMI_SKIP_COLLECT_ON_EXIT=1", "-DMI_NO_PROCESS_DETACH=1", "-DMI_FREE_USE_PAGEMAP=1", "-DMI_BUILD_RELEASE",
        "-DMI_DEFAULT_ALLOW_THP=0", "-DMI_MALLOC_OVERRIDE", "-DMI_CMAKE_BUILD_TYPE=release", "-DMI_LIBC_MUSL=1",
        "-Wno-deprecated", "-Wno-static-in-inline", "-fno-builtin-malloc", "-ftls-model=local-dynamic",
        "-DMI_PRIM_THREAD_ID=pthread_self",
      ];
      run([`${llvm}/clang++`, ...flags, `-I${join(sources, "mimalloc-bun/include")}`, "-c", join(sources, "mimalloc-bun/src/static.c"), "-o", join(dir, "mimalloc.o")]);
      writeFileSync(join(dir, "FLAGS.txt"), flags.join(" ") + "\n");
    },
  },

  webkit: {
    done: () => existsSync(join(webkitBuild, "lib/libJavaScriptCore.a")) && existsSync(join(webkitBuild, "bin/jsc")),
    make() {
      patchWebKit();
      const flags = [...toolchain, ...abiFlags, ...cpuFlags, ...(variant === "x18-allocatable" ? [] : [reserveX18]),
        ...(variant === "jit-permissions" ? ["-include", join(tree, "jsc/bun_jit_permissions.h")] : [])];
      if (!existsSync(join(webkitBuild, "build.ninja"))) {
        fresh(webkitBuild);
        // bun's options (scripts/build/deps/webkit.ts, local mode), release, no LTO.
        run(["cmake", "-S", webkitSource, "-B", webkitBuild, "-G", "Ninja", "-DPORT=JSCOnly", "-DCMAKE_BUILD_TYPE=Release",
          "-DENABLE_STATIC_JSC=ON", "-DUSE_THIN_ARCHIVES=OFF", "-DENABLE_FTL_JIT=ON", "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
          "-DUSE_BUN_JSC_ADDITIONS=ON", "-DUSE_BUN_EVENT_LOOP=ON", "-DUSE_MIMALLOC=ON", "-DUSE_EXTERNAL_MIMALLOC=ON",
          "-DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON", "-DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON", "-DENABLE_REMOTE_INSPECTOR=ON",
          "-DENABLE_MEDIA_SOURCE=OFF", "-DENABLE_MEDIA_STREAM=OFF", "-DENABLE_WEB_RTC=OFF",
          `-DCMAKE_C_COMPILER=${llvm}/clang`, `-DCMAKE_CXX_COMPILER=${llvm}/clang++`, `-DCMAKE_AR=${llvm}/llvm-ar`, `-DCMAKE_RANLIB=${llvm}/llvm-ranlib`,
          "-DCMAKE_SYSTEM_NAME=Linux", "-DCMAKE_SYSTEM_PROCESSOR=aarch64",
          "-DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER", "-DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY", "-DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY",
          `-DCMAKE_FIND_ROOT_PATH=${sysroot}`,
          `-DCMAKE_C_FLAGS=${flags.join(" ")}`, `-DCMAKE_CXX_FLAGS=${[...flags, ...cxxLibrary].join(" ")}`,
          `-DCMAKE_EXE_LINKER_FLAGS=${[...linkLibraries, "-static-pie"].join(" ")}`,
          `-DICU_ROOT=${sysroot}/usr`, `-DPORTABLE_MIMALLOC_OBJECT=${join(build, "mimalloc/mimalloc.o")}`,
        ], { log: `webkit${suffix}-configure.log` });
      }
      run(["ninja", "-C", webkitBuild, `-j${jobs}`, "jsc"], { log: `webkit${suffix}-build.log` });
    },
  },

  link: {
    done: () => existsSync(image),
    make() {
      // The link of the x86-64 image (jsc/build.ts), for this sysroot: the mem functions in
      // front of the libc, the allocator of bun, segments for pages of 64 KiB.
      mkdirSync(dirname(image), { recursive: true });
      const shell = join(webkitBuild, "Source/JavaScriptCore/shell/CMakeFiles/jsc.dir/__");
      const cmd = [
        `${llvm}/clang++`,
        ...["_Bun__reportUnhandledError", "_Bun__thisThreadHasVM", "_WTFTimer__cancel", "_WTFTimer__secondsUntilTimer", "_WTFTimer__isActive", "_WTFTimer__deinit", "_WTFTimer__update", "_WTFTimer__create"].map(s => `-Wl,-u,${s}`),
        ...toolchain, ...abiFlags, ...cpuFlags, ...cxxLibrary,
        "-fno-strict-aliasing", "-fno-exceptions", "-fno-rtti", "-ffunction-sections", "-fdata-sections", "-O3", "-DNDEBUG",
        ...linkLibraries, "-static-pie", "-Wl,-z,max-page-size=65536", "-Wl,-z,separate-loadable-segments",
        "-Xlinker", "--gc-sections", "-Xlinker", "--disable-new-dtags",
        join(shell, "jsc.cpp.o"), join(shell, "tools/JSDollarVMShell.cpp.o"), "-o", image, `-Wl,-Map=${image}.map`,
        ...["memcpy", "memmove", "memset", "memcmp", "bcmp"].map(f => join(sysroot, "usr/lib/portable-memfn", `${f}.o`)),
        "-ldl", join(build, "mimalloc/mimalloc.o"), join(webkitBuild, "lib/libJavaScriptCore.a"), join(webkitBuild, "lib/libWTF.a"),
        ...["libicudata.a", "libicui18n.a", "libicuuc.a"].map(l => join(sysroot, "usr/lib", l)),
        join(webkitBuild, "lib/libbmalloc.a"), "-ldl",
      ];
      run(cmd);
      const unsigned = createHash("sha256").update(readFileSync(image)).digest("hex");
      // Apple Silicon maps code from a file only under a code signature. Last step.
      run(["python3", join(tree, "tools/apple_sign.py"), image]);
      run(["bun", join(tree, "launch/tools/check_signature.ts"), image]);
      const text = /^\.text\s+(\d+)/m.exec(capture([`${llvm}/llvm-size`, "-A", image]))?.[1];
      const map = readFileSync(`${image}.map`, "utf8").split("\n");
      const from = (symbol: string) => {
        const at = map.findIndex(l => l.endsWith(` ${symbol}`));
        for (let i = at; i > 0; i--) if (/:\(\.[a-z]/.test(map[i])) return map[i].trim().split(/\s+/).slice(4).join(" ").replace(work + "/", "");
        return "not found";
      };
      const facts = {
        path: image,
        sha256: createHash("sha256").update(readFileSync(image)).digest("hex"),
        sha256_before_the_signature: unsigned,
        size: statSync(image).size,
        text_bytes: Number(text),
        variant: variant || "x18 reserved",
        flags: [...abiFlags, ...cpuFlags, ...(variant === "x18-allocatable" ? [] : [reserveX18]), ...(variant === "jit-permissions" ? ["-include jsc/bun_jit_permissions.h"] : [])].join(" "),
        __emutls_get_address: from("__emutls_get_address"),
        __clear_cache: from("__clear_cache"),
        __bun_libc_malloc_impl: from("__bun_libc_malloc_impl"),
        malloc: from("malloc"),
        memcpy: from("memcpy"),
        __aarch64_have_lse_atomics: from("__aarch64_have_lse_atomics"),
        __bun_jit_write_protect: from("__bun_jit_write_protect"),
      };
      writeFileSync(`${image}.json`, JSON.stringify(facts, null, 1) + "\n");
      console.log(JSON.stringify(facts, null, 1));
    },
  },

  check: {
    done: () => false,
    make() {
      // The code of the compiler is the same in both variants: what the variant without the
      // definition does with x18 is in the code that its JIT emits, which only a run shows.
      run(["bun", join(tree, "test/check_aarch64.ts"), "--sysroot", sysroot, "--image", image, "--llvm", llvm, "--out", `${image}.check.json`]);
    },
  },

  small: {
    done: () => existsSync(join(small, "requests.img")) && existsSync(join(small, "host-linux")),
    make() {
      // build.sh builds a libc and the builtins only where it finds none. It finds the ones
      // of this sysroot, through links in the places where it looks.
      const place = (to: string, at: string) => {
        mkdirSync(dirname(at), { recursive: true });
        const there = lstatSync(at, { throwIfNoEntry: false });
        if (there?.isSymbolicLink()) unlinkSync(at);
        else if (there) throw new Error(`${at} is there and is no link: ${small} has a libc of its own, take another directory (SMALL)`);
        symlinkSync(to, at);
      };
      place(join(sysroot, "usr/include"), join(small, "sysroot/include"));
      place(join(sysroot, "usr/lib"), join(small, "sysroot/lib"));
      place(join(sysroot, "usr/lib/libclang_rt.builtins.a"), join(small, "builtins/lib/linux/libclang_rt.builtins-aarch64.a"));
      run(["sh", join(tree, "build.sh"), "aarch64", small], { env: { LLVM_BIN: llvm, JOBS: jobs }, log: "small.log" });
      // test/jsc_aarch64.ts looks for the test host next to the image.
      mkdirSync(out, { recursive: true });
      copyFileSync(join(small, "host-linux"), join(out, "host-linux"));
    },
  },
};

if (import.meta.main) {
  const named = process.argv.slice(2);
  for (const name of named) if (!(name in steps)) throw new Error(`unknown step ${name}: ${Object.keys(steps).join(" ")}`);
  for (const [name, step] of Object.entries(steps)) {
    if (named.length ? !named.includes(name) : step.done()) continue;
    console.log(`== ${name}`);
    step.make();
  }
}
