// Builds the file system slice of the portable image (x86_64) and the things it is linked against.
//
//   bun build.ts [--out <dir>] [step]...
//                              steps, in this order: sysroot cdeps codegen image
//                              no step: all of them. A step whose result exists is skipped, except
//                              when it is named; "sysroot" and "image" always run.
//
//   --out   the output directory of misctools/portable/build.ts for x86_64.
//           Default: build/portable/x86_64 in the repository.
//
// Under <out>:
//   sysroot/           what `bun misctools/portable/build.ts sysroot` makes, which is the step
//                      "sysroot": the libc with the host table, the builtins, the C++ runtime
//   slice/cdeps/       libcdeps.a: the C and C++ that bun's crates call (mimalloc, highway, simdutf,
//                      the number conversions of WTF), and the slice's own shim.c. The archive is made
//                      of what a portable build of bun compiled for the image ($PORTABLE_BUILD, or
//                      build/release-portable of this checkout, which
//                      `bun misctools/portable/build.ts bun` makes), see CDEPS below. With $CDEPS it
//                      is a copy of that archive
//   slice/codegen/     the generated files that bun's crates include, made by
//                      scripts/build.ts --mode=codegen for the configuration of the image
//   slice/target/      cargo's directory
//   slice/bun_fs_slice.img, .map, .json
//
// Environment: PORTABLE_BUILD or CDEPS (for the step cdeps), LLVM_BIN, JOBS (8), and what
// misctools/portable/build.ts reads.
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { IMAGE_LINK_FLAGS, REPOSITORY, TREE, cpuFlags, llvmBin, sysrootAt, tripleOf } from "../flags.ts";
import { ARCH, places } from "./places.ts";

const here = dirname(import.meta.path);
const args = process.argv.slice(2);
const { out, slice, image, portableBuild } = places(args);
const llvm = llvmBin();
const jobs = process.env.JOBS ?? "8";
const triple = tripleOf(ARCH);
const sysroot = sysrootAt(join(out, "sysroot"), ARCH);
const config = join(sysroot.root, "portable.cfg");

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

/**
 * What libcdeps.a is made of, all of it from a portable build of bun: the code is the one bun compiles
 * for the image, with the flags of bun's build.
 */
const CDEPS = {
  /** Objects of the build directory: mimalloc, and bun's functions in front of simdutf. */
  objects: ["obj/vendor/mimalloc/src/static.c.o", "obj/src/simdutf_sys/bun-simdutf.cpp.o"],
  /** Directories of the build directory whose objects all belong to it: highway. */
  directories: ["obj/vendor/highway/hwy"],
  /**
   * Members of deps/WebKit/lib/libWTF.a: simdutf, the bounds of the stack of a thread, and the conversions
   * between numbers and text.
   */
  wtf: [
    "SIMDUTF.cpp.o",
    "StackBounds.cpp.o",
    "dtoa.cpp.o",
    "bignum-dtoa.cc.o",
    "bignum.cc.o",
    "cached-powers.cc.o",
    "double-conversion.cc.o",
    "fast-dtoa.cc.o",
    "fixed-dtoa.cc.o",
    "strtod.cc.o",
  ],
  /**
   * Sources that bun's build compiles in one object with others. Each is compiled by itself, with the
   * command that compile_commands.json of the build directory has for it.
   *   keep    the functions of the source that the archive has, where the rest of it needs JavaScriptCore
   *   leave   the functions of the source that the archive does not have: the shim of a slice defines them
   *           (the start of the standard streams), or the C of the loop slice (sys_preadv2, sys_pwritev2)
   */
  sources: [
    { file: "src/jsc/bindings/highway_strings.cpp" },
    {
      file: "src/jsc/bindings/c-bindings.cpp",
      leave: ["bun_initialize_process", "bun_is_stdio_null", "sys_preadv2", "sys_pwritev2"],
    },
    {
      file: "src/jsc/bindings/wtf-bindings.cpp",
      keep: ["Bun__StackCheck__initialize", "Bun__StackCheck__getMaxStack", "WTF__dtoa", "WTF__parseDouble"],
    },
  ],
};

function buildCdeps(dir: string) {
  const inBuild = (path: string) => join(portableBuild, path);
  const commandsPath = inBuild("compile_commands.json");
  const library = inBuild("deps/WebKit/lib/libWTF.a");
  const objects = [
    ...CDEPS.objects.map(inBuild),
    ...CDEPS.directories.flatMap(directory =>
      (existsSync(inBuild(directory)) ? readdirSync(inBuild(directory)) : [])
        .filter(name => name.endsWith(".o"))
        .sort()
        .map(name => join(inBuild(directory), name)),
    ),
  ];
  const absent = [commandsPath, library, ...CDEPS.objects.map(inBuild), ...CDEPS.directories.map(inBuild)].filter(
    path => !existsSync(path),
  );
  if (absent.length)
    throw new Error(
      `no portable build of bun at ${portableBuild} (${absent[0]} is not there): bun misctools/portable/build.ts bun makes it, or CDEPS is the path of a libcdeps.a`,
    );

  const members = join(dir, "wtf");
  mkdirSync(members, { recursive: true });
  run([`${llvm}/llvm-ar`, "x", "--output", members, library, ...CDEPS.wtf]);
  objects.push(...CDEPS.wtf.map(name => join(members, name)));

  const commands = JSON.parse(readFileSync(commandsPath, "utf8")) as { file: string; arguments: string[] }[];
  for (const { file, keep = [], leave = [] } of CDEPS.sources as {
    file: string;
    keep?: string[];
    leave?: string[];
  }[]) {
    const source = join(REPOSITORY, file);
    const command = commands.find(entry => entry.file === source);
    if (!command) throw new Error(`${commandsPath} has no command for ${source}`);
    const name = file.replace(/^.*\//, "").replace(/\.[a-z]+$/, "");
    const whole = join(dir, `${name}.whole.o`);
    const object = join(dir, `${name}.o`);
    // The words of the command are written the way a shell reads them.
    run(["/bin/sh", "-c", [...command.arguments, "-o", `'${whole.replaceAll("'", "'\\''")}'`].join(" ")], {
      cwd: REPOSITORY,
    });
    run([
      `${llvm}/llvm-objcopy`,
      ...keep.map(symbol => `--keep-global-symbol=${symbol}`),
      ...leave.map(symbol => `--localize-symbol=${symbol}`),
      whole,
      object,
    ]);
    rmSync(whole);
    objects.push(object);
  }
  run([`${llvm}/llvm-ar`, "rcs", join(dir, "libcdeps.a"), ...objects]);
  writeFileSync(
    join(dir, "libcdeps.json"),
    JSON.stringify(
      { portable_build: portableBuild, objects: objects.map(path => path.replace(dir + "/", "")) },
      null,
      1,
    ) + "\n",
  );
}

const steps: Record<string, { done: () => boolean; make: () => void }> = {
  sysroot: {
    // build.ts knows which part of the sysroot is current.
    done: () => false,
    make() {
      run([process.execPath, join(TREE, "build.ts"), "sysroot", "--arch", ARCH, "--out", out]);
    },
  },

  cdeps: {
    done: () => existsSync(join(slice, "cdeps/libcdeps.a")) && existsSync(join(slice, "cdeps/libslice_shim.a")),
    make() {
      const archive = process.env.CDEPS;
      if (archive !== undefined && !existsSync(archive))
        throw new Error(
          "CDEPS is not the path of libcdeps.a: the C and C++ that bun's crates call, compiled for the image",
        );
      const dir = join(slice, "cdeps");
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      if (archive !== undefined) copyFileSync(archive, join(dir, "libcdeps.a"));
      else buildCdeps(dir);
      run([
        `${llvm}/clang`,
        `--config=${config}`,
        "-O2",
        ...cpuFlags(ARCH),
        "-fno-omit-frame-pointer",
        "-fno-stack-protector",
        "-fstack-clash-protection",
        "-fvisibility=hidden",
        "-ffunction-sections",
        "-fdata-sections",
        "-Wall",
        "-Wextra",
        "-c",
        join(here, "src/shim.c"),
        "-o",
        join(dir, "shim.o"),
      ]);
      // The archive has its own bun_restore_stdio and friends: the slice's are the ones to link.
      run([`${llvm}/llvm-ar`, "rcs", join(dir, "libslice_shim.a"), join(dir, "shim.o")]);
    },
  },

  codegen: {
    done: () => existsSync(join(slice, "codegen/build_options.rs")),
    make() {
      mkdirSync(join(slice, "logs"), { recursive: true });
      run(
        [
          process.execPath,
          join(REPOSITORY, "scripts/build.ts"),
          "--mode=codegen",
          "--profile=portable",
          `--build-dir=${join(slice, "codegen-build")}`,
          `-j${jobs}`,
        ],
        { cwd: REPOSITORY, log: join(slice, "logs/codegen.log") },
      );
      const dir = join(slice, "codegen");
      mkdirSync(dir, { recursive: true });
      for (const name of ["json_byte_class.rs", "xml_byte_class.rs", "runtime.out.js", "build_options.rs"])
        copyFileSync(join(slice, "codegen-build/codegen", name), join(dir, name));
    },
  },

  image: {
    done: () => false,
    make() {
      mkdirSync(slice, { recursive: true });
      copyFileSync(join(REPOSITORY, "Cargo.lock"), join(here, "Cargo.lock"));
      const map = join(slice, "bun_fs_slice.map");
      const imageLinkFlags: string[] = [];
      for (let i = 0; i < IMAGE_LINK_FLAGS.length; i += 2)
        imageLinkFlags.push(`-Clink-arg=-Wl,${IMAGE_LINK_FLAGS[i]},${IMAGE_LINK_FLAGS[i + 1]}`);
      // scripts/build/rust.ts (release, linux), with what --portable adds. No linker-plugin-lto: the
      // rlibs hold machine code, and the link is the linker's alone.
      const rustflags = [
        "-Cforce-frame-pointers=yes",
        "-Cllvm-args=-addrsig",
        "-Zshare-generics=y",
        "-Ctarget-cpu=nehalem",
        "--check-cfg=cfg(bun_asan)",
        "--check-cfg=cfg(bun_debug)",
        "--check-cfg=cfg(bun_codegen_embed)",
        "--cfg=bun_codegen_embed",
        "--check-cfg=cfg(socket_fault_injection)",
        "--check-cfg=cfg(bun_portable)",
        "--check-cfg=cfg(rustix_use_libc)",
        "--cfg=rustix_use_libc",
        "--cfg=bun_portable",
        "-Zlocation-detail=none",
        "-Alinker_messages",
        "-Cforce-unwind-tables=no",
        "--cap-lints=warn",
        "-Ctarget-feature=+crt-static",
        "-Crelocation-model=pie",
        "-Cno-redzone=yes",
        "-Ztls-model=emulated",
        "-Clink-self-contained=no",
        `-Clinker=${llvm}/clang++`,
        // In front of the C library, as bun's link has its allocator: malloc and its family are the ones
        // of mimalloc, and the ones of the C library are not taken.
        `-Zpre-link-args=${join(slice, "cdeps/libcdeps.a")}`,
        `-Clink-arg=--config=${config}`,
        "-Clink-arg=-Qunused-arguments",
        `-Clink-arg=-Wl,--Map=${map}`,
        "-Clink-arg=-Wl,--gc-sections",
        ...imageLinkFlags,
        "-Clink-arg=-Wl,-z,noexecstack",
        `-Clink-arg=${join(slice, "cdeps/libslice_shim.a")}`,
        `-Clink-arg=${join(slice, "cdeps/libcdeps.a")}`,
        "-Clink-arg=-lc++",
        "-Clink-arg=-lclang_rt.builtins",
      ];
      // cargo does not know the archives and the C library of the link: what it made of the program
      // before goes, so that it links again.
      const made = join(slice, "target", triple, "release");
      rmSync(join(made, "bun-fs-slice"), { force: true });
      rmSync(join(made, "build/bun-fs-slice"), { recursive: true, force: true });
      run(
        [
          "cargo",
          "build",
          "--release",
          "--target",
          triple,
          "-Zbuild-std=std,core,alloc,panic_abort",
          "-Zbuild-std-features=panic-unwind,default",
        ],
        {
          cwd: here,
          env: {
            CARGO_TARGET_DIR: join(slice, "target"),
            CARGO_BUILD_JOBS: jobs,
            BUN_CODEGEN_DIR: join(slice, "codegen"),
            CC: `${llvm}/clang`,
            CXX: `${llvm}/clang++`,
            AR: `${llvm}/llvm-ar`,
            CARGO_ENCODED_RUSTFLAGS: rustflags.join("\x1f"),
          },
        },
      );
      copyFileSync(join(slice, "target", triple, "release/bun-fs-slice"), image);
      chmodSync(image, 0o755);
      const bytes = readFileSync(image);
      const facts = {
        path: image,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: statSync(image).size,
        rustflags,
      };
      writeFileSync(join(slice, "bun_fs_slice.json"), JSON.stringify(facts, null, 1) + "\n");
      console.log(`${image}: ${facts.size} bytes, sha256 ${facts.sha256}`);
    },
  },
};

for (const name of args) if (!(name in steps)) throw new Error(`unknown step ${name}: ${Object.keys(steps).join(" ")}`);
for (const [name, step] of Object.entries(steps)) {
  if (args.length ? !args.includes(name) : step.done()) continue;
  console.log(`== ${name}`);
  step.make();
}
