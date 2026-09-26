// Builds the C library of the portable image, the test images and the Linux test host, and runs the tests.
//
//   bun build.ts [x86_64|aarch64] [out dir]     default: x86_64, out/<arch>
//
//   <out>/sysroot          musl 1.2.5 with the host table patch (libc/patch_musl.ts)
//   <out>/threads.img      static-pie image, runs on linux as is (test/threads.c)
//   <out>/linux_paths.img  second image, for test/run.sh (test/linux_paths.c)
//   <out>/adopt.img        threads that the image did not create (test/adopt.c, test/adopt_cpp.cpp,
//                          and test/adopt.list: the functions whose check the compiler writes)
//   <out>/host-linux       POSIX host in hosted mode, for testing the host path on linux
// aarch64 only:
//   <out>/builtins         compiler-rt builtins, built from source with the flags of the image
//   the images end with an ad-hoc Apple code signature (tools/apple_sign.ts)
//
// An image of another architecture than this machine runs under qemu-<arch> (user mode).
// Environment: LLVM_BIN, JOBS (8), RUNS (1, how often each test runs),
//   MUSL_GIT, LLVM_GIT, LLVM_TAG (where the sources are cloned from).
//   An existing <out>/llvm-project is used as it is.
//
// The Windows and macOS hosts build on their own OS, for the architecture of the image:
//   clang -O2 -o host.exe host/host_win.c -lsynchronization -ladvapi32
//   cc -O2 -o host host/host_posix.c
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const args = process.argv.slice(2);
const arch = args[0] === "x86_64" || args[0] === "aarch64" ? args.shift()! : "x86_64";
const out = resolve(args[0] ?? join(here, "out", arch));
const llvm = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
const jobs = process.env.JOBS ?? "8";
const runs = Number(process.env.RUNS ?? "1");
const sys = join(out, "sysroot");
const target = `${arch}-linux-musl`;
// Windows x64 has no red zone. x18 is reserved on Windows (TEB) and macOS: the image never writes it.
// A stack that Windows made grows through a guard page, one page at a time: a frame that is larger
// than a page touches each of its pages in order (-fstack-clash-protection), as code that is
// compiled for Windows does. The image runs on such a stack when a thread of Windows enters it.
const imageFlags =
  arch === "x86_64"
    ? ["-mno-red-zone", "-fno-stack-protector", "-fstack-clash-protection", "-fPIE"]
    : ["-ffixed-x18", "-fno-stack-protector", "-fPIE"];
const emulator = process.arch === (arch === "x86_64" ? "x64" : "arm64") ? [] : [`qemu-${arch}`];

function run(cmd: string[], options: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}) {
  const result = Bun.spawnSync(cmd, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: options.quiet ? "pipe" : "inherit",
    stderr: options.quiet ? "pipe" : "inherit",
  });
  if (result.exitCode !== 0) {
    if (options.quiet)
      console.error(Buffer.concat([result.stdout, result.stderr]).toString().split("\n").slice(-40).join("\n"));
    throw new Error(`exit code ${result.exitCode}: ${cmd.join(" ")}`);
  }
  return result;
}
const output = (cmd: string[]) => Bun.spawnSync(cmd, { stdout: "pipe" }).stdout.toString().trim();

mkdirSync(out, { recursive: true });
const resource = output([`${llvm}/clang`, "-print-resource-dir"]);
const cc = [`${llvm}/clang`, `--target=${target}`];

if (!existsSync(join(sys, "lib/libc.a"))) {
  const musl = join(out, "musl");
  rmSync(musl, { recursive: true, force: true });
  run([
    "git",
    "-c",
    "advice.detachedHead=false",
    "clone",
    "-q",
    "--depth",
    "1",
    "--branch",
    "v1.2.5",
    process.env.MUSL_GIT ?? "https://github.com/kraj/musl",
    musl,
  ]);
  run(["bun", join(here, "libc/patch_musl.ts"), musl]);
  const tools = { AR: `${llvm}/llvm-ar`, RANLIB: `${llvm}/llvm-ranlib` };
  if (arch === "x86_64") {
    const env = { ...tools, CC: `${llvm}/clang`, CFLAGS: "-O2 -mno-red-zone -fPIE -fno-stack-protector -fstack-clash-protection" };
    run(["./configure", `--prefix=${sys}`, "--disable-shared"], { cwd: musl, env, quiet: true });
  } else {
    const env = { ...tools, CC: cc.join(" "), CFLAGS: `-O2 ${imageFlags.join(" ")}` };
    run(["./configure", `--target=${target}`, `--prefix=${sys}`, "--disable-shared"], { cwd: musl, env, quiet: true });
  }
  run(["make", `-j${jobs}`], { cwd: musl, quiet: true });
  run(["make", "install"], { cwd: musl, quiet: true });
}

let builtins: string;
if (arch === "x86_64") {
  builtins = output([`${llvm}/clang`, "--print-libgcc-file-name", "--rtlib=compiler-rt"]);
} else {
  // The machine has the builtins for x86 only. musl's printf needs the 128-bit long double helpers
  // (__addtf3 ...), so build them, with the image flags.
  builtins = join(out, `builtins/lib/linux/libclang_rt.builtins-${arch}.a`);
  if (!existsSync(builtins)) {
    const source = join(out, "llvm-project");
    if (!existsSync(join(source, "compiler-rt/lib/builtins"))) {
      rmSync(source, { recursive: true, force: true });
      run([
        "git",
        "-c",
        "advice.detachedHead=false",
        "clone",
        "-q",
        "--depth",
        "1",
        "--filter=blob:none",
        "--sparse",
        "--branch",
        process.env.LLVM_TAG ?? "llvmorg-23.1.2",
        process.env.LLVM_GIT ?? "https://github.com/llvm/llvm-project",
        source,
      ]);
      run([
        "git",
        "-C",
        source,
        "sparse-checkout",
        "set",
        "compiler-rt/lib/builtins",
        "compiler-rt/cmake",
        "cmake",
        "llvm/cmake",
        "third-party/siphash",
      ]);
    }
    const flags = [
      "-nostdinc",
      "-isystem",
      join(sys, "include"),
      "-isystem",
      join(resource, "include"),
      ...imageFlags,
    ].join(" ");
    run(
      [
        "cmake",
        "-G",
        "Ninja",
        "-S",
        join(source, "compiler-rt/lib/builtins"),
        "-B",
        join(out, "builtins"),
        "-DCMAKE_BUILD_TYPE=Release",
        `-DCMAKE_C_COMPILER=${llvm}/clang`,
        `-DCMAKE_CXX_COMPILER=${llvm}/clang++`,
        `-DCMAKE_ASM_COMPILER=${llvm}/clang`,
        `-DCMAKE_AR=${llvm}/llvm-ar`,
        `-DCMAKE_RANLIB=${llvm}/llvm-ranlib`,
        `-DCMAKE_NM=${llvm}/llvm-nm`,
        `-DCMAKE_C_COMPILER_TARGET=${target}`,
        `-DCMAKE_CXX_COMPILER_TARGET=${target}`,
        `-DCMAKE_ASM_COMPILER_TARGET=${target}`,
        "-DCMAKE_SYSTEM_NAME=Linux",
        `-DCMAKE_SYSTEM_PROCESSOR=${arch}`,
        `-DCMAKE_C_FLAGS=${flags}`,
        `-DCMAKE_CXX_FLAGS=${flags}`,
        `-DCMAKE_ASM_FLAGS=${flags}`,
        "-DCMAKE_C_FLAGS_RELEASE=-O2 -DNDEBUG",
        "-DCMAKE_CXX_FLAGS_RELEASE=-O2 -DNDEBUG",
        "-DCMAKE_ASM_FLAGS_RELEASE=-O2 -DNDEBUG",
        "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY",
        "-DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON",
        "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF",
      ],
      { quiet: true },
    );
    run(["ninja", "-C", join(out, "builtins"), `-j${jobs}`], { quiet: true });
  }
}

const headers = ["-nostdinc", "-isystem", join(sys, "include"), "-isystem", join(resource, "include")];
const libraries = [`-L${join(sys, "lib")}`, "-lc", builtins, "-lc", join(sys, "lib/crtn.o")];

/** test/<name>.c, and the other sources, become <out>/<name>.img */
function image(name: string, more: { sources?: string[]; flags?: string[] } = {}) {
  const object = join(out, `${name}.o`);
  const flags = ["-O2", ...headers, "-femulated-tls", ...imageFlags, ...(more.flags ?? [])];
  run([...cc, ...flags, "-c", "-o", object, join(here, "test", `${name}.c`)]);
  const others = (more.sources ?? []).map(source => {
    const other = join(out, `${source}.o`);
    const cxx = source.endsWith(".cpp") ? ["-x", "c++", "-nostdinc++", "-fno-exceptions", "-fno-rtti"] : [];
    run([...cc, ...cxx, ...flags, "-c", "-o", other, join(here, "test", source)]);
    return other;
  });
  run([
    `${llvm}/ld.lld`,
    "-static",
    "-pie",
    "--no-dynamic-linker",
    "-z",
    "noexecstack",
    "-z",
    "max-page-size=65536",
    "-z",
    "separate-loadable-segments",
    "-o",
    join(out, `${name}.img`),
    join(sys, "lib/rcrt1.o"),
    join(sys, "lib/crti.o"),
    object,
    ...others,
    ...libraries,
  ]);
  // Apple Silicon maps code from a file only under a code signature. Last step.
  if (arch === "aarch64") run(["bun", join(here, "tools/apple_sign.ts"), join(out, `${name}.img`)], { quiet: true });
}
image("threads");
image("linux_paths");
// The compiler writes the call of the check at the entry of the functions of the list, which is how C
// and C++ that the host OS calls get it.
image("adopt", {
  sources: ["adopt_cpp.cpp"],
  flags: ["-fsanitize-coverage=func,trace-pc", `-fsanitize-coverage-allowlist=${join(here, "test/adopt.list")}`],
});

if (arch === "x86_64") {
  run(["cc", "-O2", "-o", join(out, "host-linux"), join(here, "host/host_posix.c"), "-lpthread"]);
} else {
  // The test host is a static aarch64 linux program. Its libc is the sysroot of the image, which is a
  // normal musl when no host table arrives. The host itself is built WITHOUT -ffixed-x18: see "x18" in
  // host/host_posix.c.
  run([
    ...cc,
    "-O2",
    ...headers,
    "-fno-stack-protector",
    "-c",
    "-o",
    join(out, "host-linux.o"),
    join(here, "host/host_posix.c"),
  ]);
  run([
    `${llvm}/ld.lld`,
    "-static",
    "-z",
    "noexecstack",
    "-o",
    join(out, "host-linux"),
    join(sys, "lib/crt1.o"),
    join(sys, "lib/crti.o"),
    join(out, "host-linux.o"),
    ...libraries,
  ]);
}

let failed = false;
/** A run passes with the exit code and, when given, an output that matches. */
function check(name: string, command: string[], expected: { exitCode: number; output?: RegExp }) {
  let passes = 0;
  for (let i = 1; i <= runs; i++) {
    const result = Bun.spawnSync([...emulator, ...command], { stdout: "pipe", stderr: "pipe" });
    const text = result.stdout.toString();
    // A program that a signal ended has the exit code 128 + the number of the signal in a shell.
    const exitCode =
      result.exitCode ?? (result.signalCode === "SIGSEGV" ? 139 : result.signalCode === "SIGILL" ? 132 : 128);
    const ok = exitCode === expected.exitCode && (!expected.output || expected.output.test(text));
    if (ok) passes++;
    else
      console.log(
        `${name}: run ${i} FAILED with exit code ${exitCode}${result.signalCode ? ` (${result.signalCode})` : ""}\n${text}${result.stderr.toString()}`,
      );
    if (ok && i === 1 && text) process.stdout.write(`  ${text}`);
  }
  console.log(`${name}: ${passes} of ${runs} runs passed`);
  if (passes !== runs) failed = true;
}
const probe = join(out, "probe.tmp");
// Exit code 42 is a pass.
check(`${arch} threads direct`, [join(out, "threads.img"), probe], { exitCode: 42 });
check(`${arch} threads hosted`, [join(out, "host-linux"), join(out, "threads.img"), probe], { exitCode: 42 });
{
  // Who wrote the check of the callback: its source, or the compiler for a function of test/adopt.list.
  for (const [who, what] of [
    ["source", "the check is in the source"],
    ["listed", "C, the compiler wrote the check"],
    ["listed-cpp", "C++, the compiler wrote the check"],
  ]) {
    check(`${arch} adopt direct (${what})`, [join(out, "adopt.img"), who], {
      exitCode: 42,
      output: new RegExp(`^adopt: mode=direct check=${who} calls=50 sum=1225 adopted_now=0 adopted_ever=0$`, "m"),
    });
    check(
      `${arch} adopt hosted: 8 threads of the host call into the image (${what})`,
      [join(out, "host-linux"), join(out, "adopt.img"), who],
      {
        exitCode: 42,
        output: new RegExp(
          `^adopt: mode=hosted check=${who} threads=8 calls=400 sum=149800 expected=149800 adopted_now=0 adopted_ever=8 destructors=8 image_threads_ok=4/4 main_tls=unset$`,
          "m",
        ),
      },
    );
  }
  // 139 is SIGSEGV: without the check the first use of the thread pointer is an address near 0.
  for (const [who, what] of [
    ["no-check", "the source does not check"],
    ["unlisted", "C that the list does not name"],
    ["unlisted-cpp", "C++ that the list does not name"],
  ])
    check(`${arch} adopt hosted, must fail: ${what}`, [join(out, "host-linux"), join(out, "adopt.img"), who], {
      exitCode: 139,
    });
}
if (existsSync(probe)) rmSync(probe);
process.exit(failed ? 1 : 0);
