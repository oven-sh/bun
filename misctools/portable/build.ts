/**
 * Builds and tests the portable image: one machine-code image per CPU architecture that runs on Linux by
 * itself, and on Windows and macOS through a native host.
 *
 *   bun misctools/portable/build.ts <command> [--arch x86_64|aarch64] [--out <dir>] [--runs <n>] [-- <arguments>]
 *
 *   sysroot      everything an image links against, compiled with the flags of the image (flags.ts), in this
 *                order: musl with the host table, compiler-rt's builtins, libunwind + libc++abi + libc++, ICU,
 *                the memory functions of LLVM libc. A step whose output is current is skipped.
 *   test-image   the test images of the libc: threads.img, linux_paths.img, requests.img, raw_syscall.img
 *                (x86_64), and memory_model, the test of host/memory.h. Builds the libc if it has to.
 *   host         the POSIX host (host/host_posix.c) for this machine. With an --arch that is not this
 *                machine's: the static Linux host of that architecture, which runs under qemu-<arch>.
 *   jsc          JavaScriptCore's shell as an image: jsc.img. Builds the sysroot, bun's mimalloc and WebKit
 *                if it has to, and runs the static checks.
 *   bun          all of bun as an image, x86_64: builds the sysroot, then runs bun's own build against it
 *                (scripts/build.ts --profile=portable). What follows `--` goes to that build.
 *   check        the static checks, on the disassembly of the sysroot and of every image in the output
 *                directory: no thread-local, syscall or red zone instruction outside of the libc, x18 never
 *                written (aarch64), the Apple code signature well formed (aarch64).
 *   test         builds the host and the test images, then runs every image by itself and through the
 *                host, each test --runs times, the static checks of the libc and the images, and the
 *                scenarios of jsc.img if `jsc` has built it. An image of another architecture than this
 *                machine runs under qemu-<arch>, and so does its host.
 *
 *   --arch   the architecture of the image. Default: the one of this machine.
 *   --out    the output directory. Default: build/portable/<arch> in the repository.
 *   --runs   how often `test` runs each test. Default: 5.
 *
 * Tools for a built image of bun, each with its paths as arguments: image/smoke.ts, image/analyze.ts,
 * image/run-tests.ts, image/bench.ts. For the hosts: test/coverage.ts. On macOS and on Windows, with the
 * host of that system: test/jsc_scenarios.ts.
 *
 * Environment:
 *   LLVM_BIN         directory of clang, ld.lld and the llvm tools. Default: where the clang of PATH is.
 *   JOBS             parallel compile jobs. Default: 8.
 *   CC               the C compiler for programs of this machine (host, memory_model). Default: cc.
 *   LINUX_HEADERS    directory with the headers of the Linux kernel. Default: /usr/include.
 *   BUN_WEBKIT_PATH  a checkout of oven-sh/WebKit. It is read, never written. Without it `jsc` clones the
 *                    commit of scripts/build/deps/webkit.ts into the output directory.
 *   MIMALLOC_TLS     `default` (thread locals of the compiler, which are emulated here) or `pthreads`.
 *   MUSL_GIT, LLVM_GIT, ICU_URL, WEBKIT_GIT, MIMALLOC_GIT
 *                    where a source is fetched from, in place of the address in the table below.
 *
 * The Windows host is not built here: clang for the MSVC target, in a developer prompt of Visual Studio.
 *   clang -O2 --target=x86_64-pc-windows-msvc -o host.exe host\host_win.c
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ARCHES, type Arch, REPOSITORY, hostArch } from "./flags.ts";
import { buildBun } from "./steps/bun.ts";
import { check } from "./steps/check.ts";
import { type Context, type Sources, createContext } from "./steps/context.ts";
import { buildHost, buildTestImages } from "./steps/images.ts";
import { buildJsc } from "./steps/jsc.ts";
import { BuildError } from "./steps/run.ts";
import { buildLibc, buildSysroot } from "./steps/sysroot.ts";
import { test } from "./steps/test.ts";

// ───────────────────────────────────────────────────────────────────────────
// Sources
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every source that the build downloads, and the commit or release it is pinned to. They are cloned
 * shallow into <out>/src, never into the repository.
 *
 * WebKit and mimalloc are not here: bun pins them in scripts/build/deps/webkit.ts and mimalloc.ts, and an
 * image links what bun links.
 */
const SOURCES: Sources = {
  musl: {
    url: "https://github.com/kraj/musl",
    urlVariable: "MUSL_GIT",
    tag: "v1.2.5",
    commit: "0784374d561435f7c787a555aeab8ede699ed298",
  },
  // The commit that the clang of the build machines was made from (clang 23.1.2). The runtime libraries
  // and the compiler are one release.
  llvm: {
    url: "https://github.com/llvm/llvm-project",
    urlVariable: "LLVM_GIT",
    commit: "069ef0e7cb36ee1fcf3bfdad31533fd79ab85b58",
    sparse: [
      "cmake",
      "compiler-rt",
      "libc",
      "libcxx",
      "libcxxabi",
      "libunwind",
      "llvm/cmake",
      "llvm/utils/llvm-lit",
      "runtimes",
      "third-party",
    ],
  },
  icu: {
    url: "https://github.com/unicode-org/icu/releases/download/release-78.3/icu4c-78.3-sources.tgz",
    urlVariable: "ICU_URL",
    tag: "release-78.3",
    sha256: "3a2e7a47604ba702f345878308e6fefeca612ee895cf4a5f222e7955fabfe0c0",
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Commands
// ───────────────────────────────────────────────────────────────────────────

interface Options {
  arch: Arch;
  out: string;
  runs: number;
  /** What follows `--`. */
  rest: string[];
}

/** A command returns false when what it built is there and a check or a test of it failed. */
const COMMANDS: Record<string, (ctx: Context, options: Options) => Promise<boolean>> = {
  async sysroot(ctx) {
    await buildSysroot(ctx);
    return true;
  },

  async "test-image"(ctx) {
    await buildTestImages(ctx, await buildLibc(ctx));
    return true;
  },

  async host(ctx) {
    await buildHost(ctx, ctx.arch === hostArch() ? "" : await buildLibc(ctx));
    return true;
  },

  async jsc(ctx) {
    await buildJsc(ctx, await buildSysroot(ctx));
    return await check(ctx, true);
  },

  async bun(ctx, options) {
    await buildSysroot(ctx);
    return await buildBun(ctx, options.rest);
  },

  async check(ctx) {
    return await check(ctx, true);
  },

  async test(ctx, options) {
    const libc = await buildLibc(ctx);
    await buildTestImages(ctx, libc);
    await buildHost(ctx, libc);
    return await test(ctx, options.runs);
  },
};

const USAGE = `usage: bun misctools/portable/build.ts <command> [--arch ${ARCHES.join("|")}] [--out <dir>] [--runs <n>] [-- <arguments>]
commands: ${Object.keys(COMMANDS).join(" ")}
The comment at the top of misctools/portable/build.ts says what each of them does.
`;

function parseArguments(argv: string[]): { command: string; options: Options } {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    process.stderr.write(USAGE);
    process.exit(command === undefined ? 2 : 0);
  }
  if (!(command in COMMANDS)) throw new BuildError(`unknown command ${command}`, { hint: USAGE });
  let arch: Arch = hostArch();
  let out: string | undefined;
  let runs = 5;
  const separator = rest.indexOf("--");
  const passedOn = separator < 0 ? [] : rest.splice(separator).slice(1);
  for (let i = 0; i < rest.length; i++) {
    const [name, inline] = rest[i]!.split(/=(.*)/s) as [string, string | undefined];
    const value = inline ?? rest[++i];
    if (value === undefined) throw new BuildError(`${name} needs a value`, { hint: USAGE });
    if (name === "--arch") {
      if (!ARCHES.includes(value as Arch)) throw new BuildError(`--arch ${value}: not one of ${ARCHES.join(", ")}`);
      arch = value as Arch;
    } else if (name === "--out") {
      out = value;
    } else if (name === "--runs") {
      runs = Number(value);
      if (!Number.isInteger(runs) || runs < 1) throw new BuildError(`--runs ${value}: not a number of runs`);
    } else {
      throw new BuildError(`unknown option ${name}`, { hint: USAGE });
    }
  }
  const options = { arch, out: resolve(out ?? join(REPOSITORY, "build", "portable", arch)), runs, rest: passedOn };
  return { command, options };
}

async function main(): Promise<void> {
  const { command, options } = parseArguments(process.argv.slice(2));
  mkdirSync(options.out, { recursive: true });
  const ctx = createContext(options.arch, options.out, SOURCES);
  if (!(await COMMANDS[command]!(ctx, options))) process.exit(1);
}

main().catch(error => {
  if (error instanceof BuildError) {
    process.stderr.write(error.format());
    process.exit(1);
  }
  throw error;
});
