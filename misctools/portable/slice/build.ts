// Builds the file system slice of the portable image (x86_64) and the things it is linked against.
//
//   bun build.ts [step]...     steps, in this order: musl sysroot cdeps codegen image
//                              no step: all of them. A step whose result exists is skipped, except
//                              when it is named; "image" always runs.
//
// Under WORK (default /tmp/portable/n2):
//   musl/          what ../build.ts makes: musl 1.2.5 with the host table (libc/patch_musl.ts), the
//                  two test images, the Linux test host
//   sysroot/       BASE_SYSROOT without ICU, with its musl replaced by the one of musl/ and
//                  emutls.c.o taken out of the compiler-rt builtins (the libc has it)
//   cdeps/         libcdeps.a: the C and C++ that bun's crates call, copied from CDEPS, and the
//                  slice's own shim.c
//   codegen/       the generated files bun's crates include, copied from CODEGEN
//   target/        cargo's directory
//   out/bun_fs_slice.img, .map, .json
//
// Environment: WORK, BASE_SYSROOT (/tmp/portable/sysroot), CDEPS (the libcdeps.a of the Rust spike),
// CODEGEN, LLVM_BIN, JOBS (8), MUSL_GIT.
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, statSync, copyFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const repo = resolve(tree, "../..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n2");
const baseSysroot = process.env.BASE_SYSROOT ?? "/tmp/portable/sysroot";
const baseCdeps = process.env.CDEPS ?? "/tmp/portable/rust/cdeps/out/portable-nolto/libcdeps.a";
const baseCodegen = process.env.CODEGEN ?? "/tmp/portable/rust/codegen";
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const jobs = process.env.JOBS ?? "8";
const triple = "x86_64-unknown-linux-musl";
const sysroot = join(work, "sysroot");
const out = join(work, "out");

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

const steps: Record<string, { done: () => boolean; make: () => void }> = {
  musl: {
    done: () => existsSync(join(work, "musl/sysroot/lib/libc.a")) && existsSync(join(work, "musl/host-linux")),
    make() {
      mkdirSync(join(work, "logs"), { recursive: true });
      run(["bun", join(tree, "build.ts"), "x86_64", join(work, "musl")], { env: { JOBS: jobs }, log: join(work, "logs/musl-build.log") });
    },
  },

  sysroot: {
    done: () => existsSync(join(sysroot, ".patched")),
    make() {
      rmSync(sysroot, { recursive: true, force: true });
      mkdirSync(join(sysroot, "usr/lib"), { recursive: true });
      cpSync(join(baseSysroot, "usr/include"), join(sysroot, "usr/include"), { recursive: true });
      cpSync(join(baseSysroot, "clang-resource-dir"), join(sysroot, "clang-resource-dir"), { recursive: true });
      copyFileSync(join(baseSysroot, "portable.cfg"), join(sysroot, "portable.cfg"));
      for (const lib of ["libc++.a", "libc++abi.a", "libunwind.a", "libclang_rt.builtins.a"]) copyFileSync(join(baseSysroot, "usr/lib", lib), join(sysroot, "usr/lib", lib));
      const musl = join(work, "musl/sysroot");
      cpSync(join(musl, "include"), join(sysroot, "usr/include"), { recursive: true, force: true });
      cpSync(join(musl, "lib"), join(sysroot, "usr/lib"), { recursive: true, force: true });
      for (const archive of [join(sysroot, "usr/lib/libclang_rt.builtins.a"), join(sysroot, "clang-resource-dir/lib/x86_64-unknown-linux-musl/libclang_rt.builtins.a")])
        run([`${llvm}/llvm-ar`, "d", archive, "emutls.c.o"]);
      writeFileSync(
        join(sysroot, "README.txt"),
        `Sysroot of the file system slice, made by misctools/portable/slice/build.ts.
  usr/include, usr/lib/{libc.a,crt1.o,rcrt1.o,Scrt1.o,crti.o,crtn.o}   musl 1.2.5 patched by libc/patch_musl.ts (${join(work, "musl")})
  usr/include/c++, usr/lib/{libc++.a,libc++abi.a,libunwind.a}, clang-resource-dir, portable.cfg   copies from ${baseSysroot}
  libclang_rt.builtins.a (both copies)   emutls.c.o removed: __emutls_get_address is in libc.a
`,
      );
      writeFileSync(join(sysroot, ".patched"), "");
    },
  },

  cdeps: {
    done: () => existsSync(join(work, "cdeps/libcdeps.a")),
    make() {
      const dir = join(work, "cdeps");
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      copyFileSync(baseCdeps, join(dir, "libcdeps.a"));
      run([
        `${llvm}/clang`, `--config=${join(sysroot, "portable.cfg")}`, "-O2", "-march=nehalem", "-fno-omit-frame-pointer", "-fno-stack-protector", "-fstack-clash-protection",
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
      const map = join(out, "bun_fs_slice.map");
      // scripts/build/rust.ts (release, linux), with what --portable adds. No linker-plugin-lto: the
      // rlibs hold machine code, and the link is the linker's alone.
      const rustflags = [
        "-Cforce-frame-pointers=yes", "-Cllvm-args=-addrsig", "-Zshare-generics=y", "-Ctarget-cpu=nehalem",
        "--check-cfg=cfg(bun_asan)", "--check-cfg=cfg(bun_debug)", "--check-cfg=cfg(bun_codegen_embed)", "--cfg=bun_codegen_embed",
        "--check-cfg=cfg(socket_fault_injection)", "--check-cfg=cfg(bun_portable)", "--check-cfg=cfg(rustix_use_libc)",
        "--cfg=rustix_use_libc", "--cfg=bun_portable",
        "-Zlocation-detail=none", "-Alinker_messages", "-Cforce-unwind-tables=no", "--cap-lints=warn",
        "-Ctarget-feature=+crt-static", "-Crelocation-model=pie", "-Cno-redzone=yes", "-Ztls-model=emulated", "-Clink-self-contained=no",
        `-Clinker=${llvm}/clang++`,
        `-Clink-arg=--config=${join(sysroot, "portable.cfg")}`,
        "-Clink-arg=-Qunused-arguments",
        `-Clink-arg=-Wl,--Map=${map}`,
        "-Clink-arg=-Wl,--gc-sections",
        "-Clink-arg=-Wl,-z,max-page-size=65536", "-Clink-arg=-Wl,-z,separate-loadable-segments", "-Clink-arg=-Wl,-z,noexecstack",
        `-Clink-arg=${join(work, "cdeps/libslice_shim.a")}`,
        `-Clink-arg=${join(work, "cdeps/libcdeps.a")}`,
        "-Clink-arg=-lc++", "-Clink-arg=-lclang_rt.builtins",
      ];
      // cargo does not know the archives and the C library of the link: what it made of the program
      // before goes, so that it links again.
      const made = join(work, "target/image", triple, "release");
      rmSync(join(made, "bun-fs-slice"), { force: true });
      rmSync(join(made, "build/bun-fs-slice"), { recursive: true, force: true });
      run(
        ["cargo", "build", "--release", "--target", triple, "-Zbuild-std=std,core,alloc,panic_abort", "-Zbuild-std-features=panic-unwind,default"],
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
      const image = join(out, "bun_fs_slice.img");
      copyFileSync(join(work, "target/image", triple, "release/bun-fs-slice"), image);
      chmodSync(image, 0o755);
      const bytes = readFileSync(image);
      const facts = {
        path: image,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: statSync(image).size,
        rustflags,
      };
      writeFileSync(join(out, "bun_fs_slice.json"), JSON.stringify(facts, null, 1) + "\n");
      console.log(`${image}: ${facts.size} bytes, sha256 ${facts.sha256}`);
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
