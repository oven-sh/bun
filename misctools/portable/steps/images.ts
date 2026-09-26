/**
 * The test images of the libc, and the test host.
 *
 *   <out>/threads.img       static-pie image, runs on linux as it is (test/threads.c)
 *   <out>/linux_paths.img   what only Linux does for a program: vfork, signals, cancellation (test/linux_paths.c)
 *   <out>/requests.img      one request after the other, with the answers of Linux (test/requests.c)
 *   <out>/raw_syscall.img   x86_64: an image that issues a syscall itself. The tests show that the host ends
 *                           it and that the static checks report it (test/raw_syscall.c)
 *   <out>/memory_model      test of host/memory.h by itself, a program of this machine (test/memory_model.c)
 *   <out>/host-linux        the POSIX host in hosted mode, for testing the host path on linux
 *
 * An aarch64 image ends with an ad-hoc Apple code signature (tools/apple_sign.ts).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { IMAGE_LINK_FLAGS, TREE, abiFlags, hostArch, targetOf } from "../flags.ts";
import { sign } from "../tools/apple_sign.ts";
import { type Context, type Step, inOut, runStep } from "./context.ts";
import { run, sha256File } from "./run.ts";

/** The images of an architecture, by the name of their source in test/. */
export function testImages(ctx: Context): string[] {
  return ["threads", "linux_paths", "requests", ...(ctx.arch === "x86_64" ? ["raw_syscall"] : [])];
}

/** The C compiler of this machine, for the programs that run on it: $CC, or cc. */
function machineCompiler(): string {
  return process.env.CC ?? "cc";
}

/** Compiles a C file for the image: musl's headers in front of clang's own, as the musl target wants them. */
function compileForImage(ctx: Context, source: string, object: string, flags: string[]): void {
  run([
    join(ctx.llvm, "clang"),
    `--target=${targetOf(ctx.arch)}`,
    "-O2",
    "-nostdinc",
    "-isystem",
    ctx.sysroot.include,
    "-isystem",
    join(ctx.sysroot.resourceDir, "include"),
    ...flags,
    "-c",
    "-o",
    object,
    source,
  ]);
}

/** The libraries of a C program, in the order of the link: libc, builtins, libc again for what those need. */
function libraries(ctx: Context): string[] {
  return [`-L${ctx.sysroot.lib}`, "-lc", ctx.sysroot.builtins, "-lc"];
}

function image(ctx: Context, name: string, before: string): Step {
  const source = join(TREE, "test", `${name}.c`);
  const file = inOut(ctx, `${name}.img`);
  const link = ["-static", "-pie", "--no-dynamic-linker", "-z", "noexecstack", ...IMAGE_LINK_FLAGS];
  return {
    name: `image-${name}`,
    inputs: [before, sha256File(source), abiFlags(ctx.arch), link],
    outputs: [file],
    make() {
      const object = inOut(ctx, "build", "images", `${name}.o`);
      mkdirSync(inOut(ctx, "build", "images"), { recursive: true });
      compileForImage(ctx, source, object, abiFlags(ctx.arch));
      const crt = (part: string) => join(ctx.sysroot.lib, part);
      run([
        join(ctx.llvm, "ld.lld"),
        ...link,
        "-o",
        file,
        crt("rcrt1.o"),
        crt("crti.o"),
        object,
        ...libraries(ctx),
        crt("crtn.o"),
      ]);
      // Apple Silicon maps code from a file only under a code signature. Last step.
      if (ctx.arch === "aarch64") sign(file);
    },
  };
}

function memoryModel(ctx: Context): Step {
  const source = join(TREE, "test", "memory_model.c");
  const command = [machineCompiler(), "-O2", "-o", inOut(ctx, "memory_model"), source];
  return {
    name: "memory_model",
    inputs: [sha256File(source), sha256File(join(TREE, "host", "memory.h")), command],
    outputs: [inOut(ctx, "memory_model")],
    make() {
      mkdirSync(ctx.out, { recursive: true });
      run(command);
    },
  };
}

/** The name of the host program on this machine. */
export function hostName(): string {
  return process.platform === "darwin" ? "host-macos" : "host-linux";
}

/**
 * The POSIX host (host/host_posix.c). For an image of this machine's architecture it is a program of this
 * machine, built with its compiler. For another architecture it is what runs next to the image under the
 * emulator: a static Linux program of that architecture. Its libc is the sysroot of the image, which is
 * a normal musl when no host table arrives. It is built WITHOUT the flags of the image: see "x18" in
 * host/host_posix.c.
 */
function host(ctx: Context, before: string): Step {
  const source = join(TREE, "host", "host_posix.c");
  const headers = ["linux_abi.h", "memory.h"].map(name => sha256File(join(TREE, "host", name)));
  const file = inOut(ctx, hostName());
  if (ctx.arch === hostArch()) {
    const command = [
      machineCompiler(),
      "-O2",
      "-o",
      file,
      source,
      ...(process.platform === "linux" ? ["-lpthread"] : []),
    ];
    return {
      name: "host",
      inputs: [sha256File(source), headers, command],
      outputs: [file],
      make() {
        mkdirSync(ctx.out, { recursive: true });
        run(command);
      },
    };
  }
  return {
    name: "host",
    inputs: [before, sha256File(source), headers],
    outputs: [file],
    make() {
      const object = inOut(ctx, "build", "images", "host-linux.o");
      mkdirSync(inOut(ctx, "build", "images"), { recursive: true });
      compileForImage(ctx, source, object, ["-fno-stack-protector"]);
      const crt = (part: string) => join(ctx.sysroot.lib, part);
      run([
        join(ctx.llvm, "ld.lld"),
        "-static",
        "-z",
        "noexecstack",
        "-o",
        file,
        crt("crt1.o"),
        crt("crti.o"),
        object,
        ...libraries(ctx),
        crt("crtn.o"),
      ]);
    },
  };
}

/** `libc` is the identity of the libc and the builtins that the images link against. */
export async function buildTestImages(ctx: Context, libc: string): Promise<void> {
  for (const name of testImages(ctx)) await runStep(ctx, image(ctx, name, libc));
  await runStep(ctx, memoryModel(ctx));
}

export async function buildHost(ctx: Context, libc: string): Promise<void> {
  await runStep(ctx, host(ctx, libc));
}
