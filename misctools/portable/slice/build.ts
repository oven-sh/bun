// Builds the file system slice of the portable image and the things it is linked against.
//
//   bun build.ts [--arch x86_64|aarch64] [step]...
//                              steps, in this order: musl sysroot cdeps codegen image
//                              no step: all of them. A step whose result exists is skipped, except
//                              when it is named; "image" always runs.
//
// Under WORK (default /tmp/portable/n3), <arch> is x86_64 or aarch64:
//   musl-<arch>/     what ../build.sh makes: musl 1.2.5 with the host table (libc/patch_musl.py), the
//                    test images, the Linux test host
//   sysroot-<arch>/  BASE_SYSROOT without ICU, with its musl replaced by the one of musl-<arch>/ and
//                    emutls.c.o taken out of the compiler-rt builtins (the libc has it)
//   cdeps-<arch>/    libcdeps.a: the C and C++ that bun's crates call, and the slice's own shim.c.
//                    x86_64: a copy of CDEPS. aarch64: compiled here from CDEPS_SOURCES, the vendored
//                    mimalloc and highway, and the headers of WebKit
//   codegen/         the generated files bun's crates include, copied from CODEGEN
//   target/          cargo's directory
//   out/bun_fs_slice-<arch>.img, .map, .json
//
// Environment: WORK, BASE_SYSROOT (x86_64: /tmp/portable/sysroot, aarch64: /tmp/portable/j64/sysroot-aarch64),
// CDEPS (the libcdeps.a of the Rust spike), CDEPS_SOURCES, VENDOR, WEBKIT_INCLUDE, CODEGEN, LLVM_BIN,
// JOBS (8), MUSL_GIT.
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, statSync, copyFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const repo = resolve(tree, "../..");
const argv = process.argv.slice(2);
const arch = argv.includes("--arch") ? argv.splice(argv.indexOf("--arch"), 2)[1] : "x86_64";
if (arch !== "x86_64" && arch !== "aarch64") throw new Error(`--arch ${arch}: x86_64 or aarch64`);
const work = resolve(process.env.WORK ?? "/tmp/portable/n3");
const baseSysroot = process.env.BASE_SYSROOT ?? (arch === "x86_64" ? "/tmp/portable/sysroot" : "/tmp/portable/j64/sysroot-aarch64");
const baseCdeps = process.env.CDEPS ?? "/tmp/portable/rust/cdeps/out/portable-nolto/libcdeps.a";
const cdepsSources = process.env.CDEPS_SOURCES ?? "/tmp/portable/rust/cdeps/src";
const vendor = process.env.VENDOR ?? "/workspace/bun/vendor";
const webkitInclude = process.env.WEBKIT_INCLUDE ?? "/root/.bun/build-cache/webkit-35e8970dfd926abf-lto/include";
const baseCodegen = process.env.CODEGEN ?? "/tmp/portable/rust/codegen";
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const jobs = process.env.JOBS ?? "8";
const triple = `${arch}-unknown-linux-musl`;
const muslOut = join(work, `musl-${arch}`);
const sysroot = join(work, `sysroot-${arch}`);
const cdeps = join(work, `cdeps-${arch}`);
const out = join(work, "out");
/** What the image of this architecture is compiled with, next to the target (see ../build.sh). */
const abiFlags = arch === "x86_64" ? ["-femulated-tls", "-mno-red-zone", "-fPIE"] : ["-femulated-tls", "-ffixed-x18", "-fPIE", "-moutline-atomics"];
const cpuFlags = arch === "x86_64" ? ["-march=nehalem"] : ["-march=armv8-a+crc"];

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
    if (options.log) console.error(readFileSync(options.log, "utf8").split("\n").slice(-60).join("\n"));
    throw new Error(`exit code ${result.exitCode}: ${cmd[0]}`);
  }
}

const steps: Record<string, { done: () => boolean; make: () => void | Promise<void> }> = {
  musl: {
    done: () => existsSync(join(muslOut, "sysroot/lib/libc.a")) && existsSync(join(muslOut, "host-linux")),
    make() {
      mkdirSync(join(work, "logs"), { recursive: true });
      run(["sh", join(tree, "build.sh"), arch, muslOut], { env: { JOBS: jobs }, log: join(work, `logs/musl-${arch}.log`) });
    },
  },

  sysroot: {
    done: () => existsSync(join(sysroot, ".patched")),
    make() {
      rmSync(sysroot, { recursive: true, force: true });
      mkdirSync(join(sysroot, "usr/lib"), { recursive: true });
      cpSync(join(baseSysroot, "usr/include"), join(sysroot, "usr/include"), { recursive: true });
      cpSync(join(baseSysroot, "clang-resource-dir"), join(sysroot, "clang-resource-dir"), { recursive: true });
      writeFileSync(
        join(sysroot, "portable.cfg"),
        [
          `# clang configuration file of this sysroot (${arch}, musl, libc++), written by misctools/portable/slice/build.ts.`,
          `--target=${arch}-linux-musl`,
          "--sysroot=<CFGDIR>",
          "-resource-dir=<CFGDIR>/clang-resource-dir",
          "-stdlib++-isystem <CFGDIR>/usr/include/c++/v1",
          ...abiFlags,
          "-stdlib=libc++",
          "-rtlib=compiler-rt",
          "-unwindlib=libunwind",
          "-fuse-ld=lld",
          "",
        ].join("\n"),
      );
      for (const lib of ["libc++.a", "libc++abi.a", "libunwind.a"]) copyFileSync(join(baseSysroot, "usr/lib", lib), join(sysroot, "usr/lib", lib));
      // The builtins of compiler-rt. aarch64: the ones that ../build.sh made from source.
      const builtins = arch === "x86_64" ? join(baseSysroot, "usr/lib/libclang_rt.builtins.a") : join(muslOut, "builtins/lib/linux/libclang_rt.builtins-aarch64.a");
      const inResourceDir = join(sysroot, `clang-resource-dir/lib/${arch}-unknown-linux-musl/libclang_rt.builtins.a`);
      copyFileSync(builtins, join(sysroot, "usr/lib/libclang_rt.builtins.a"));
      copyFileSync(builtins, inResourceDir);
      const musl = join(muslOut, "sysroot");
      cpSync(join(musl, "include"), join(sysroot, "usr/include"), { recursive: true, force: true });
      cpSync(join(musl, "lib"), join(sysroot, "usr/lib"), { recursive: true, force: true });
      for (const archive of [join(sysroot, "usr/lib/libclang_rt.builtins.a"), inResourceDir]) run([`${llvm}/llvm-ar`, "d", archive, "emutls.c.o"]);
      writeFileSync(
        join(sysroot, "README.txt"),
        `Sysroot of the file system slice, made by misctools/portable/slice/build.ts.
  usr/include, usr/lib/{libc.a,crt1.o,rcrt1.o,Scrt1.o,crti.o,crtn.o}   musl 1.2.5 patched by libc/patch_musl.py (${muslOut})
  usr/include/c++, usr/lib/{libc++.a,libc++abi.a,libunwind.a}, clang-resource-dir, portable.cfg   copies from ${baseSysroot}
  libclang_rt.builtins.a (both copies)   emutls.c.o removed: __emutls_get_address is in libc.a
`,
      );
      writeFileSync(join(sysroot, ".patched"), "");
    },
  },

  cdeps: {
    done: () => existsSync(join(cdeps, "libcdeps.a")),
    async make() {
      const dir = cdeps;
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, "obj"), { recursive: true });
      if (arch === "x86_64") copyFileSync(baseCdeps, join(dir, "libcdeps.a"));
      else await compileCdeps(dir);
      run([
        `${llvm}/clang`, `--config=${join(sysroot, "portable.cfg")}`, "-O2", ...cpuFlags, "-fno-omit-frame-pointer", "-fno-stack-protector",
        "-fvisibility=hidden", "-ffunction-sections", "-fdata-sections", "-Wall", "-Wextra", "-c", join(here, "src/shim.c"), "-o", join(dir, "shim.o"),
      ]);
      // The spike's archive has its own bun_restore_stdio and friends: the slice's are the ones to link.
      run([`${llvm}/llvm-ar`, "rcs", join(dir, "libslice_shim.a"), join(dir, "shim.o")]);
    },
  },

  codegen: {
    done: () => existsSync(join(work, "codegen/build_options.rs")),
    make() {
      const dir = join(work, "codegen");
      mkdirSync(dir, { recursive: true });
      for (const name of ["json_byte_class.rs", "xml_byte_class.rs", "runtime.out.js"]) copyFileSync(join(baseCodegen, name), join(dir, name));
      // build_options.rs is written at configure time by scripts/build/buildOptionsRs.ts. The copy
      // gets the paths of this build and the cfg that the configuration of the image adds.
      let options = readFileSync(join(baseCodegen, "build_options.rs"), "utf8");
      options = options.replace(/pub const BASE_PATH: &\[u8\] = "[^"]*"/, `pub const BASE_PATH: &[u8] = "${repo}"`);
      options = options.replace(/pub const CODEGEN_PATH: &\[u8\] = "[^"]*"/, `pub const CODEGEN_PATH: &[u8] = "${dir}"`);
      if (!options.includes("bun_portable")) options = options.replace(/(target_os = "freebsd",\n)/, `$1    bun_portable,\n`);
      writeFileSync(join(dir, "build_options.rs"), options);
    },
  },

  image: {
    done: () => false,
    make() {
      mkdirSync(out, { recursive: true });
      copyFileSync(join(repo, "Cargo.lock"), join(here, "Cargo.lock"));
      const map = join(out, `bun_fs_slice-${arch}.map`);
      // scripts/build/rust.ts (release, linux), with what --portable adds. No linker-plugin-lto: the
      // rlibs hold machine code, and the link is the linker's alone.
      const rustflags = [
        "-Cforce-frame-pointers=yes", "-Cllvm-args=-addrsig", "-Zshare-generics=y",
        ...(arch === "x86_64" ? ["-Ctarget-cpu=nehalem", "-Cno-redzone=yes"] : ["-Ctarget-cpu=generic", "-Ctarget-feature=+crc", "-Zfixed-x18"]),
        "--check-cfg=cfg(bun_asan)", "--check-cfg=cfg(bun_debug)", "--check-cfg=cfg(bun_codegen_embed)", "--cfg=bun_codegen_embed",
        "--check-cfg=cfg(socket_fault_injection)", "--check-cfg=cfg(bun_portable)", "--check-cfg=cfg(rustix_use_libc)",
        "--cfg=rustix_use_libc", "--cfg=bun_portable",
        "-Zlocation-detail=none", "-Alinker_messages", "-Cforce-unwind-tables=no", "--cap-lints=warn",
        "-Ctarget-feature=+crt-static", "-Crelocation-model=pie", "-Ztls-model=emulated", "-Clink-self-contained=no",
        `-Clinker=${llvm}/clang++`,
        `-Clink-arg=--config=${join(sysroot, "portable.cfg")}`,
        "-Clink-arg=-Qunused-arguments",
        `-Clink-arg=-Wl,--Map=${map}`,
        "-Clink-arg=-Wl,--gc-sections",
        "-Clink-arg=-Wl,-z,max-page-size=65536", "-Clink-arg=-Wl,-z,separate-loadable-segments", "-Clink-arg=-Wl,-z,noexecstack",
        `-Clink-arg=${join(cdeps, "libslice_shim.a")}`,
        `-Clink-arg=${join(cdeps, "libcdeps.a")}`,
        "-Clink-arg=-lc++", "-Clink-arg=-lclang_rt.builtins",
      ];
      // rustc links a static program that can be loaded anywhere (static-pie) for x86_64 musl, and not
      // for aarch64 musl: its description of that target does not say that the target has them. The
      // image is one, so the target is described here, as rustc describes it and with that one line more.
      let target = triple;
      if (arch === "aarch64") {
        const printed = Bun.spawnSync(["rustc", "-Zunstable-options", "--print", "target-spec-json", "--target", triple], { stdout: "pipe", stderr: "inherit" });
        if (printed.exitCode !== 0) throw new Error("rustc --print target-spec-json");
        const spec = JSON.parse(printed.stdout.toString());
        delete spec["is-builtin"];
        spec["static-position-independent-executables"] = true;
        mkdirSync(join(work, "targets"), { recursive: true });
        target = join(work, "targets", `${triple}.json`);
        writeFileSync(target, JSON.stringify(spec, null, 1) + "\n");
      }
      run(
        ["cargo", "build", "--release", "--target", target, "-Zbuild-std=std,core,alloc,panic_abort", "-Zbuild-std-features=panic-unwind,default", ...(arch === "aarch64" ? ["-Zjson-target-spec"] : [])],
        {
          cwd: here,
          env: {
            CARGO_TARGET_DIR: join(work, "target/image"),
            CARGO_BUILD_JOBS: jobs,
            BUN_CODEGEN_DIR: join(work, "codegen"),
            CC: `${llvm}/clang`,
            CXX: `${llvm}/clang++`,
            AR: `${llvm}/llvm-ar`,
            CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f"),
          },
        },
      );
      const image = join(out, `bun_fs_slice-${arch}.img`);
      copyFileSync(join(work, "target/image", triple, "release/bun-fs-slice"), image);
      chmodSync(image, 0o755);
      const bytes = readFileSync(image);
      const facts = {
        path: image,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: statSync(image).size,
        rustflags,
      };
      writeFileSync(join(out, `bun_fs_slice-${arch}.json`), JSON.stringify(facts, null, 1) + "\n");
      console.log(`${image}: ${facts.size} bytes, sha256 ${facts.sha256}`);
    },
  },
};

/** The C and C++ that bun's crates call, compiled for the image: the list of the Rust spike
    (its build-cdeps.sh, variant "portable", without link time optimization), without zlib. */
async function compileCdeps(dir: string) {
  const common = [
    `--config=${join(sysroot, "portable.cfg")}`, "-O3", "-DNDEBUG", "-g1", "-fno-omit-frame-pointer", "-mno-omit-leaf-frame-pointer", "-fno-stack-protector",
    "-fvisibility=hidden", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-ffunction-sections", "-fdata-sections", "-faddrsig",
    "-fno-semantic-interposition", ...cpuFlags, "-w",
  ];
  const cxx = ["-std=c++23", "-fno-exceptions", "-fno-rtti", "-fno-c++-static-destructors", "-fvisibility-inlines-hidden"];
  const highway = ["-DHWY_STATIC_DEFINE", "-DHWY_DISABLED_TARGETS=HWY_ALL_SVE-HWY_SVE2_128", "-fmath-errno"];
  const wtf = ["-DHAVE_CONFIG_H=1", "-DBUILDING_WITH_CMAKE=1", `-I${join(cdepsSources, "wtf")}`, `-I${webkitInclude}`];
  const units: { source: string; flags: string[] }[] = [
    {
      source: join(vendor, "mimalloc/src/static.c"),
      flags: [
        "-x", "c++", `-I${join(vendor, "mimalloc/include")}`, "-DMI_STATIC_LIB", "-DMI_SKIP_COLLECT_ON_EXIT=1", "-DMI_NO_PROCESS_DETACH=1", "-DMI_FREE_USE_PAGEMAP=1",
        "-DMI_BUILD_RELEASE", "-DMI_DEFAULT_ALLOW_THP=0", "-DMI_CMAKE_BUILD_TYPE=release", "-Wno-deprecated", "-Wno-static-in-inline",
        // No thread register in compiled code, and no override of malloc: the libc of the image has its own.
        "-DMI_LIBC_MUSL=1", "-DMI_TLS_MODEL_PTHREADS=1", "-DMI_PRIM_THREAD_ID=pthread_self",
      ],
    },
    ...["abort", "aligned_allocator", "nanobenchmark", "per_target", "perf_counters", "print", "profiler", "targets", "timer"].map(name => ({
      source: join(vendor, `highway/hwy/${name}.cc`),
      flags: [`-I${join(vendor, "highway")}`, ...highway],
    })),
    { source: join(cdepsSources, "bun/highway_strings.cpp"), flags: [`-I${join(cdepsSources, "bun")}`, `-I${join(vendor, "highway")}`, `-I${join(vendor, "highway/hwy")}`, ...highway] },
    ...["bun/CPUFeatures.cpp", "bun/linux_perf_tracing.cpp", "bun/bun-simdutf.cpp", "shim/simdutf_impl.cpp", "shim/bun_shims.cpp"].map(name => ({ source: join(cdepsSources, name), flags: [] as string[] })),
    ...["dtoa.cpp", "FastFloat.cpp", "dragonbox/dragonbox_to_chars.cpp", ...["bignum-dtoa", "bignum", "cached-powers", "diy-fp", "double-conversion", "fast-dtoa", "fixed-dtoa", "strtod"].map(name => `dtoa/${name}.cc`)].map(
      name => ({ source: join(cdepsSources, "wtf", name), flags: wtf }),
    ),
    { source: join(cdepsSources, "shim/wtf_numbers.cpp"), flags: wtf },
  ];
  const objects: string[] = [];
  const failures: string[] = [];
  const queue = units.map((unit, index) => ({ ...unit, object: join(dir, "obj", `${String(index).padStart(3, "0")}-${unit.source.split("/").pop()}.o`) }));
  for (const unit of queue) objects.push(unit.object);
  const worker = async () => {
    for (let unit = queue.shift(); unit; unit = queue.shift()) {
      const command = [`${llvm}/clang++`, ...common, ...cxx, ...unit.flags, "-c", unit.source, "-o", unit.object];
      const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
      const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      if (code !== 0) failures.push(`${unit.source}:\n${errors.split("\n").slice(0, 20).join("\n")}`);
    }
  };
  const running = Array.from({ length: Number(jobs) }, worker);
  console.log(`+ compiling ${objects.length} files of C and C++ for ${arch}`);
  await Promise.all(running);
  if (failures.length) throw new Error(failures.join("\n"));
  run([`${llvm}/llvm-ar`, "rcs", join(dir, "libcdeps.a"), ...objects]);
}

const named = argv;
for (const name of named) if (!(name in steps)) throw new Error(`unknown step ${name}: ${Object.keys(steps).join(" ")}`);
for (const [name, step] of Object.entries(steps)) {
  if (named.length ? !named.includes(name) : step.done()) continue;
  console.log(`== ${name}`);
  await step.make();
}
