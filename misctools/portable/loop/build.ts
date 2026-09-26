// Builds the loop slice of the portable image (x86_64) and the things it is linked against.
//
//   bun build.ts [step]...     steps, in this order: base usockets flavors image
//                              no step: all of them. A step whose result exists is skipped, except
//                              when it is named; "flavors" and "image" always run.
//
// Under WORK (default /tmp/portable/n2):
//   musl/ sysroot/ cdeps/ codegen/     what ../slice/build.ts makes (step "base")
//   usockets/posix/*.o                 uSockets of bun on epoll, compiled for the image
//   usockets/windows/*.o               uSockets of bun on libuv, its code for Windows, compiled for the
//                                      image against windows/uv.h (uv_header.ts); what it defines has a
//                                      name of its own (<name>__windows)
//   flavors/<os>/<crate>               bun's crates as each OS compiles them (flavor.ts)
//   image-loop/                        the manifest of the image, which has both flavours
//   out/bun_loop_slice.img, .map, .json, .missing.txt
//
// A crate of bun calls functions of crates and of C++ that this program is built without: the owners
// of sockets and polls in bun_runtime, JavaScriptCore, uWebSockets. The linker names them. Each one
// becomes a function that says its name and stops the program (out/bun_loop_slice.missing.txt has the
// list): the program does not reach them, and would say so if it did.
//
// Environment: WORK, LLVM_BIN, JOBS (8), and what ../slice/build.ts reads.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const repo = resolve(tree, "../..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n2");
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const jobs = process.env.JOBS ?? "8";
const triple = "x86_64-unknown-linux-musl";
const sysroot = join(work, "sysroot");
const out = join(work, "out");
const vendor = process.env.VENDOR ?? "/workspace/bun/vendor";
const seeds = "bun_threading,bun_uws_sys,bun_io,bun_spawn_sys";

function run(cmd: string[], options: { cwd?: string; env?: Record<string, string>; log?: string; allowFailure?: boolean } = {}) {
  console.log(`+ ${cmd.join(" ").slice(0, 400)}${options.cwd ? `   (in ${options.cwd})` : ""}`);
  const result = Bun.spawnSync(cmd, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: options.log ? "pipe" : "inherit",
    stderr: options.log ? "pipe" : "inherit",
    maxBuffer: 1 << 30,
  });
  if (options.log) writeFileSync(options.log, Buffer.concat([result.stdout, result.stderr]));
  if (result.exitCode !== 0 && !options.allowFailure) {
    if (options.log) console.error(readFileSync(options.log, "utf8").split("\n").slice(-60).join("\n"));
    throw new Error(`exit code ${result.exitCode}: ${cmd[0]}`);
  }
  return result.exitCode === 0;
}

/** The flags of bun's C for the image (scripts/build/flags.ts, release), without link-time optimisation. */
const cFlags = [
  `--config=${join(sysroot, "portable.cfg")}`,
  "-march=nehalem", "-DNDEBUG", "-O2", "-fno-exceptions", "-fno-omit-frame-pointer", "-fno-stack-protector", "-fvisibility=hidden",
  "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-ffunction-sections", "-fdata-sections", "-std=gnu17",
  "-Wno-c23-extensions", "-Wno-nullability-completeness",
  `-I${join(repo, "packages")}`, `-I${join(repo, "packages/bun-usockets")}`, `-I${join(repo, "packages/bun-usockets/src")}`,
  `-I${join(repo, "src/jsc/bindings")}`, `-I${join(repo, "src/uws_sys")}`,
  `-I${join(vendor, "boringssl/include")}`, `-I${join(vendor, "mimalloc/include")}`,
  "-DLIBUS_USE_OPENSSL=1", "-DUSE_BUN_MIMALLOC=1", "-DBUN_PORTABLE=1",
];
const usocketsShared = ["bsd", "context", "loop", "socket", "udp", "fault_inject"];

function objectsIn(directory: string) {
  return existsSync(directory)
    ? readdirSync(directory)
        .filter(name => name.endsWith(".o"))
        .map(name => join(directory, name))
        .sort()
    : [];
}

const flavorArguments = (os: string) => [
  "bun", join(here, "flavor.ts"), "--os", os, "--out", join(work, "flavors"),
  "--roots", join(here, "program"), "--seeds", seeds,
  "--defined-in", [join(sysroot, "usr/lib/libc.a"), join(work, "cdeps/libcdeps.a"), join(work, "cdeps/libslice_shim.a")].join(","),
  ...(os === "windows" && objectsIn(join(work, "usockets/windows-plain")).length ? ["--flavoured-c", objectsIn(join(work, "usockets/windows-plain")).join(",")] : []),
];

const steps: Record<string, { done: () => boolean; make: () => void }> = {
  base: {
    done: () => existsSync(join(sysroot, ".patched")) && existsSync(join(work, "cdeps/libcdeps.a")) && existsSync(join(work, "codegen/build_options.rs")),
    make() {
      mkdirSync(join(work, "logs"), { recursive: true });
      const missing = ["musl", "sysroot", "cdeps", "codegen"].filter(
        step =>
          !existsSync(
            { musl: join(work, "musl/sysroot/lib/libc.a"), sysroot: join(sysroot, ".patched"), cdeps: join(work, "cdeps/libcdeps.a"), codegen: join(work, "codegen/build_options.rs") }[step]!,
          ),
      );
      if (missing.length) run(["bun", join(tree, "slice/build.ts"), ...missing], { env: { WORK: work } });
    },
  },

  usockets: {
    done: () => objectsIn(join(work, "usockets/posix")).length > 0,
    make() {
      const directory = join(work, "usockets/posix");
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      for (const name of [...usocketsShared, "eventing/epoll_kqueue"])
        run([`${llvm}/clang`, ...cFlags, "-c", join(repo, "packages/bun-usockets/src", `${name}.c`), "-o", join(directory, `${name.split("/").pop()}.o`)]);
      if (existsSync(join(here, "windows.ts"))) run(["bun", join(here, "windows.ts"), work]);
    },
  },

  flavors: {
    done: () => false,
    make() {
      for (const os of ["posix", "windows"]) run(flavorArguments(os));
    },
  },

  image: {
    done: () => false,
    make() {
      mkdirSync(out, { recursive: true });
      const directory = join(work, "image-loop");
      mkdirSync(directory, { recursive: true });
      copyFileSync(join(repo, "Cargo.lock"), join(directory, "Cargo.lock"));
      const flavor = (os: string) => `{ package = "loop_program__${os}", path = "${join(work, "flavors", os, "loop_program")}" }`;
      writeFileSync(
        join(directory, "Cargo.toml"),
        `# Written by misctools/portable/loop/build.ts: the loop slice of the portable image.
[workspace]

[package]
name = "bun-loop-slice"
version = "0.0.0"
edition = "2024"

[[bin]]
name = "bun-loop-slice"
path = "${join(here, "src/main.rs")}"

[dependencies]
bun_alloc = { path = "${join(repo, "src/bun_alloc")}" }
bun_core = { path = "${join(repo, "src/bun_core")}" }
bun_sys = { path = "${join(repo, "src/sys")}" }
bun_windows_sys = { path = "${join(repo, "src/windows_sys")}" }
program_posix = ${flavor("posix")}
program_windows = ${flavor("windows")}

[profile.release]
lto = "off"
codegen-units = 1
debug = "line-tables-only"
strip = "none"
panic = "abort"
`,
      );
      const map = join(out, "bun_loop_slice.map");
      const archive = (name: string, objects: string[]) => {
        const path = join(work, "usockets", name);
        rmSync(path, { force: true });
        run([`${llvm}/llvm-ar`, "rcs", path, ...objects]);
        return path;
      };
      const posix = archive("libusockets_posix.a", objectsIn(join(work, "usockets/posix")));
      const windowsObjects = objectsIn(join(work, "usockets/windows"));
      const windows = windowsObjects.length ? [archive("libusockets_windows.a", windowsObjects)] : [];
      const missingSource = join(directory, "missing.s");
      const missingObject = join(directory, "missing.o");
      const missingArchive = join(directory, "libmissing.a");
      const link = (missing: string[]) => {
        // Every function that nothing defines: it says its name and stops.
        const lines = [
          "# Written by misctools/portable/loop/build.ts: functions of bun that this program is built without.",
          '\t.section .rodata.bun_missing,"a",@progbits',
          ...missing.map((name, index) => `.Lname${index}:\n\t.asciz "${name}"`),
          "\t.text",
          ...missing.flatMap((name, index) => [`\t.globl ${name}`, `\t.type ${name},@function`, `${name}:`, `\tleaq .Lname${index}(%rip), %rdi`, "\tjmp bun_slice_missing_symbol"]),
          '\t.section .note.GNU-stack,"",@progbits',
        ];
        writeFileSync(missingSource, lines.join("\n") + "\n");
        run([`${llvm}/clang`, `--config=${join(sysroot, "portable.cfg")}`, "-c", missingSource, "-o", missingObject]);
        rmSync(missingArchive, { force: true });
        run([`${llvm}/llvm-ar`, "rcs", missingArchive, missingObject]);
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
          "-Clink-arg=-Wl,--error-limit=0",
          "-Clink-arg=-Wl,-z,max-page-size=65536", "-Clink-arg=-Wl,-z,separate-loadable-segments", "-Clink-arg=-Wl,-z,noexecstack",
          "-Clink-arg=-Wl,--start-group",
          `-Clink-arg=${posix}`,
          ...windows.map(path => `-Clink-arg=${path}`),
          `-Clink-arg=${join(work, "cdeps/libslice_shim.a")}`,
          `-Clink-arg=${join(work, "cdeps/libloop_shim.a")}`,
          `-Clink-arg=${join(work, "cdeps/libcdeps.a")}`,
          `-Clink-arg=${missingArchive}`,
          "-Clink-arg=-Wl,--end-group",
          "-Clink-arg=-lc++", "-Clink-arg=-lclang_rt.builtins",
        ];
        const log = join(work, "logs", `loop-image-link-${missing.length}.log`);
        const ok = run(["cargo", "build", "--release", "--target", triple, "-Zbuild-std=std,core,alloc,panic_abort", "-Zbuild-std-features=panic-unwind,default"], {
          cwd: directory,
          env: {
            CARGO_TARGET_DIR: join(work, "target/image-loop"),
            CARGO_BUILD_JOBS: jobs,
            BUN_CODEGEN_DIR: join(work, "codegen"),
            CC: `${llvm}/clang`,
            CXX: `${llvm}/clang++`,
            AR: `${llvm}/llvm-ar`,
            CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f"),
          },
          log,
          allowFailure: true,
        });
        return { ok, log, rustflags };
      };
      // The C of the program itself: what tells of a missing function.
      run([`${llvm}/clang`, ...cFlags, "-c", join(here, "src/shim.c"), "-o", join(work, "cdeps/loop_shim.o")]);
      rmSync(join(work, "cdeps/libloop_shim.a"), { force: true });
      run([`${llvm}/llvm-ar`, "rcs", join(work, "cdeps/libloop_shim.a"), join(work, "cdeps/loop_shim.o")]);

      const known = join(out, "bun_loop_slice.missing.txt");
      let missing = existsSync(known) ? readFileSync(known, "utf8").split("\n").filter(Boolean) : [];
      let result = link(missing);
      for (let round = 0; !result.ok && round < 4; round++) {
        const text = readFileSync(result.log, "utf8");
        const found = [...text.matchAll(/undefined symbol: ([A-Za-z_$][A-Za-z_0-9$.]*)/g)].map(match => match[1]);
        const added = [...new Set(found)].filter(name => !missing.includes(name));
        if (!added.length) break;
        missing = [...missing, ...added].sort();
        console.log(`${added.length} functions that nothing defines, ${missing.length} in all`);
        result = link(missing);
      }
      if (!result.ok) {
        console.error(readFileSync(result.log, "utf8").split("\n").slice(-60).join("\n"));
        throw new Error("the image does not link");
      }
      writeFileSync(known, missing.join("\n") + "\n");

      const image = join(out, "bun_loop_slice.img");
      copyFileSync(join(work, "target/image-loop", triple, "release/bun-loop-slice"), image);
      chmodSync(image, 0o755);
      const bytes = readFileSync(image);
      const facts = {
        path: image,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: statSync(image).size,
        functions_of_bun_that_the_program_is_built_without: missing.length,
        rustflags: result.rustflags,
      };
      writeFileSync(join(out, "bun_loop_slice.json"), JSON.stringify(facts, null, 1) + "\n");
      console.log(`${image}: ${facts.size} bytes, sha256 ${facts.sha256}, ${missing.length} functions of bun are not in it`);
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
