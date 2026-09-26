// Builds the portable image of JavaScriptCore's "jsc" shell (x86_64) against the
// libc with the host table.
//
//   bun jsc/build.ts [step]...      steps, in this order: inputs sysroot mimalloc link check
//                                   no step: all of them. A step whose result exists is skipped,
//                                   except when it is named.
//
// What it needs is the result of the "jsc" spike, which compiled WebKit for the
// ABI of the image. Nothing of the spike is changed, the parts are copied:
//   SPIKE         /tmp/portable/jsc      build/webkit-portable (libJavaScriptCore.a, libWTF.a,
//                                        libbmalloc.a, the two objects of the shell), memfn/*.o
//                                        (mem functions from LLVM libc), src/mimalloc-bun
//   BASE_SYSROOT  /tmp/portable/sysroot  musl (not patched), libc++, compiler-rt builtins, ICU
// What it makes, under WORK (default: the directory above this tree):
//   inputs/       the copies
//   sysroot/      copy of BASE_SYSROOT with musl replaced by the patched build (libc.a, crt
//                 objects, headers), same flags. emutls.c.o is taken out of the compiler-rt
//                 builtins archive, so that __emutls_get_address can only come from the libc.
//   mimalloc-<model>/mimalloc.o     model: default (thread locals of the compiler, which are
//                 emulated TLS here) or pthreads (pthread_getspecific)
//   out/jsc.img, out/jsc.img.map    the image, linked for 64 KiB pages
// Other environment: LLVM_BIN, JOBS (8), MUSL_GIT, MIMALLOC_TLS (default | pthreads).
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, statSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const tree = resolve(dirname(import.meta.path), "..");
const work = resolve(process.env.WORK ?? join(tree, ".."));
const spike = process.env.SPIKE ?? "/tmp/portable/jsc";
const baseSysroot = process.env.BASE_SYSROOT ?? "/tmp/portable/sysroot";
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const jobs = process.env.JOBS ?? "8";
const muslGit = process.env.MUSL_GIT ?? "https://github.com/kraj/musl";
const tlsModel = process.env.MIMALLOC_TLS ?? "default";
const target = "x86_64-linux-musl";
const abiFlags = ["-femulated-tls", "-mno-red-zone", "-fPIE"];
const sysroot = join(work, "sysroot");
const inputs = join(work, "inputs");
const out = join(work, "out");
const image = process.env.IMAGE ?? join(out, "jsc.img");

function run(cmd: string[], options: { cwd?: string; env?: Record<string, string>; log?: string } = {}) {
  console.log(`+ ${cmd.join(" ")}${options.cwd ? `   (in ${options.cwd})` : ""}`);
  const result = Bun.spawnSync(cmd, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: options.log ? "pipe" : "inherit",
    stderr: options.log ? "pipe" : "inherit",
  });
  if (options.log) writeFileSync(options.log, Buffer.concat([result.stdout, result.stderr]));
  if (result.exitCode !== 0) {
    if (options.log) console.error(readFileSync(options.log, "utf8").split("\n").slice(-40).join("\n"));
    throw new Error(`exit code ${result.exitCode}: ${cmd[0]}`);
  }
}

const steps: Record<string, { done: () => boolean; make: () => void }> = {
  inputs: {
    done: () => existsSync(join(inputs, ".done")),
    make() {
      rmSync(inputs, { recursive: true, force: true });
      const webkit = join(spike, "build/webkit-portable");
      const shell = join(webkit, "Source/JavaScriptCore/shell/CMakeFiles/jsc.dir/__");
      mkdirSync(join(inputs, "webkit"), { recursive: true });
      for (const lib of ["libJavaScriptCore.a", "libWTF.a", "libbmalloc.a"]) cpSync(join(webkit, "lib", lib), join(inputs, "webkit", lib));
      cpSync(join(shell, "jsc.cpp.o"), join(inputs, "webkit/jsc.cpp.o"));
      cpSync(join(shell, "tools/JSDollarVMShell.cpp.o"), join(inputs, "webkit/JSDollarVMShell.cpp.o"));
      cpSync(join(spike, "memfn"), join(inputs, "memfn"), { recursive: true });
      cpSync(join(spike, "src/mimalloc-bun/src"), join(inputs, "mimalloc-bun/src"), { recursive: true });
      cpSync(join(spike, "src/mimalloc-bun/include"), join(inputs, "mimalloc-bun/include"), { recursive: true });
      writeFileSync(join(inputs, ".done"), "");
    },
  },

  sysroot: {
    done: () => existsSync(join(sysroot, ".patched")),
    make() {
      rmSync(sysroot, { recursive: true, force: true });
      run(["cp", "-a", baseSysroot, sysroot]);
      rmSync(join(sysroot, ".done"), { force: true });
      const source = join(work, "build/musl-src");
      const build = join(work, "build/musl");
      rmSync(source, { recursive: true, force: true });
      rmSync(build, { recursive: true, force: true });
      mkdirSync(build, { recursive: true });
      mkdirSync(join(work, "logs"), { recursive: true });
      run(["git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", "v1.2.5", muslGit, source]);
      run(["python3", join(tree, "libc/patch_musl.py"), source]);
      // The flags of the musl that is replaced (scripts/01-musl.sh of the spike).
      const env = {
        CC: `${llvm}/clang --target=${target}`,
        AR: `${llvm}/llvm-ar`,
        RANLIB: `${llvm}/llvm-ranlib`,
        CFLAGS: abiFlags.join(" "),
      };
      run([join(source, "configure"), `--prefix=${sysroot}/usr`, `--syslibdir=${sysroot}/lib`, "--disable-shared", "--enable-static", `--target=${target}`], { cwd: build, env, log: join(work, "logs/musl-configure.log") });
      run(["make", `-j${jobs}`], { cwd: build, env, log: join(work, "logs/musl-make.log") });
      run(["make", "install"], { cwd: build, env, log: join(work, "logs/musl-install.log") });
      for (const archive of [join(sysroot, "usr/lib/libclang_rt.builtins.a"), join(sysroot, `clang-resource-dir/lib/x86_64-unknown-linux-musl/libclang_rt.builtins.a`)])
        run([`${llvm}/llvm-ar`, "d", archive, "emutls.c.o"]);
      appendFileSync(join(sysroot, "README.txt"), `
CHANGED for the image that runs through the host table (jsc/build.ts of the portable tree):
  usr/include, usr/lib/{libc.a,crt1.o,rcrt1.o,Scrt1.o,crti.o,crtn.o}   musl 1.2.5 patched by libc/patch_musl.py,
                                same flags as before (${abiFlags.join(" ")})
  libclang_rt.builtins.a (both copies)   emutls.c.o removed: __emutls_get_address is in libc.a (bun_emutls.c)
Everything else is the copy of ${baseSysroot}.
`);
      writeFileSync(join(sysroot, ".patched"), "");
    },
  },

  mimalloc: {
    done: () => existsSync(join(work, `mimalloc-${tlsModel}/mimalloc.o`)),
    make() {
      // bun's flags for mimalloc in a release build (scripts/05-mimalloc.sh of the spike). The
      // thread id is pthread_self() in both models: what mimalloc does by itself with musl is
      // inline assembly that reads fs.
      const dir = join(work, `mimalloc-${tlsModel}`);
      mkdirSync(dir, { recursive: true });
      const flags = [
        "-x", "c++", "-std=c++20", `--target=${target}`, `--sysroot=${sysroot}`, `-resource-dir=${sysroot}/clang-resource-dir`,
        "-stdlib++-isystem", `${sysroot}/usr/include/c++/v1`, "-stdlib=libc++", ...abiFlags,
        "-O3", "-DNDEBUG", "-march=nehalem", "-fno-exceptions", "-fno-rtti", "-fno-c++-static-destructors", "-fno-omit-frame-pointer",
        "-mno-omit-leaf-frame-pointer", "-fno-stack-protector", "-fvisibility=hidden", "-fvisibility-inlines-hidden", "-fno-unwind-tables",
        "-fno-asynchronous-unwind-tables", "-ffunction-sections", "-fdata-sections", "-faddrsig", "-fno-semantic-interposition",
        "-DMI_STATIC_LIB", "-DMI_SKIP_COLLECT_ON_EXIT=1", "-DMI_NO_PROCESS_DETACH=1", "-DMI_FREE_USE_PAGEMAP=1", "-DMI_BUILD_RELEASE",
        "-DMI_DEFAULT_ALLOW_THP=0", "-DMI_MALLOC_OVERRIDE", "-DMI_CMAKE_BUILD_TYPE=release", "-DMI_LIBC_MUSL=1",
        "-Wno-deprecated", "-Wno-static-in-inline", "-fno-builtin-malloc", "-ftls-model=local-dynamic",
        "-DMI_PRIM_THREAD_ID=pthread_self",
        ...(tlsModel === "pthreads" ? ["-DMI_TLS_MODEL_PTHREADS=1"] : []),
      ];
      run([`${llvm}/clang++`, ...flags, `-I${inputs}/mimalloc-bun/include`, "-c", join(inputs, "mimalloc-bun/src/static.c"), "-o", join(dir, "mimalloc.o")]);
      writeFileSync(join(dir, "FLAGS.txt"), flags.join(" ") + "\n");
    },
  },

  link: {
    done: () => existsSync(image),
    make() {
      // out/link-portable-llvmmem.cmd of the spike, with the sysroot, the allocator and the
      // output replaced, and the two options for 64 KiB pages added.
      mkdirSync(dirname(image), { recursive: true });
      const cmd = [
        `${llvm}/clang++`,
        ...["_Bun__reportUnhandledError", "_Bun__thisThreadHasVM", "_WTFTimer__cancel", "_WTFTimer__secondsUntilTimer", "_WTFTimer__isActive", "_WTFTimer__deinit", "_WTFTimer__update", "_WTFTimer__create"].map(s => `-Wl,-u,${s}`),
        `--target=${target}`, `--sysroot=${sysroot}`, `-resource-dir=${sysroot}/clang-resource-dir`, ...abiFlags, "-march=nehalem",
        "-stdlib++-isystem", `${sysroot}/usr/include/c++/v1`, "-stdlib=libc++",
        "-fno-strict-aliasing", "-fno-exceptions", "-fno-rtti", "-ffunction-sections", "-fdata-sections", "-O3", "-DNDEBUG",
        "-fuse-ld=lld", "-static-pie", "-rtlib=compiler-rt", "-unwindlib=libunwind",
        "-Wl,-z,max-page-size=65536", "-Wl,-z,separate-loadable-segments",
        "-Xlinker", "--gc-sections", "-Xlinker", "--disable-new-dtags",
        "jsc.cpp.o", "JSDollarVMShell.cpp.o", "-o", image, `-Wl,-Map=${image}.map`,
        ...["memcpy", "memmove", "memset", "memcmp", "bcmp"].map(f => join(inputs, `memfn/${f}.o`)),
        "-ldl", join(work, `mimalloc-${tlsModel}/mimalloc.o`), "libJavaScriptCore.a", "libWTF.a",
        ...["libicudata.a", "libicui18n.a", "libicuuc.a"].map(l => join(sysroot, "usr/lib", l)),
        "libbmalloc.a", "-ldl",
      ];
      run(cmd, { cwd: join(inputs, "webkit") });
      const sizes = Bun.spawnSync([`${llvm}/llvm-size`, "-A", image]).stdout.toString();
      const text = /^\.text\s+(\d+)/m.exec(sizes)?.[1];
      const map = readFileSync(`${image}.map`, "utf8");
      const from = (symbol: string) => {
        const lines = map.split("\n");
        const at = lines.findIndex(l => l.endsWith(` ${symbol}`));
        for (let i = at; i > 0; i--) if (/:\(\.[a-z]/.test(lines[i])) return lines[i].trim().split(/\s+/).slice(4).join(" ");
        return "not found";
      };
      const facts = {
        path: image,
        sha256: createHash("sha256").update(readFileSync(image)).digest("hex"),
        size: statSync(image).size,
        text_bytes: Number(text),
        mimalloc_tls_model: tlsModel,
        __emutls_get_address: from("__emutls_get_address"),
        __bun_libc_malloc_impl: from("__bun_libc_malloc_impl"),
        malloc: from("malloc"),
      };
      writeFileSync(`${image}.json`, JSON.stringify(facts, null, 1) + "\n");
      console.log(JSON.stringify(facts, null, 1));
    },
  },

  check: {
    done: () => false,
    make() {
      // LowLevelInterpreter.cpp.o: the interpreter keeps the number of the opcode in the 4 bytes
      // after the indirect jump that ends a handler. 0x64 and 0x65 are the prefix bytes for fs
      // and gs, so a disassembler that does not know reads "addl %eax, %fs:(%rax)" there.
      run(["bun", join(tree, "test/check_x86_64.ts"), dirname(image), "--sysroot", join(sysroot, "usr"), "--image", image, "--llvm", llvm, "--allow", "^(llint_|op_|wasm_|ipint_|_?js_trampoline|vmEntry|.*LowLevelInterpreter)"]);
    },
  },
};

const named = process.argv.slice(2);
for (const name of named) if (!(name in steps)) throw new Error(`unknown step ${name}: ${Object.keys(steps).join(" ")}`);
for (const [name, step] of Object.entries(steps)) {
  if (named.length ? !named.includes(name) : step.done()) continue;
  console.log(`== ${name}`);
  step.make();
}
