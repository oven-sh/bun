/**
 * The static checks of an output directory: what the disassembly of the sysroot and of the images says,
 * without running anything that was built.
 *
 *   x86_64    test/check_x86_64.ts: no instruction below the stack pointer, no syscall that is not behind
 *             __bun_host, fs and gs in the two ways of __get_tp only, no TLS segment. And the control: the
 *             check reports raw_syscall.img, the image that issues a syscall itself.
 *   aarch64   test/check_aarch64.ts: x18 is never written, no svc that is not behind __bun_host, the thread
 *             register in the three ways of __get_tp only, no TLS segment. test/check_signature.ts: the
 *             Apple code signature of every image.
 *
 * Checked are the libc, musl's crt objects, the builtins and every image of the output directory. The
 * command `check` also reads every other library of the sysroot that is built: none of them may have any
 * of these instructions. The command `test` leaves those out, its images link none of them.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkAarch64 } from "../test/check_aarch64.ts";
import { SignatureError, checkSignature } from "../test/check_signature.ts";
import { checkX86_64 } from "../test/check_x86_64.ts";
import { type Context, inOut } from "./context.ts";

/** The image whose only purpose is to break the rules. */
const MUST_FAIL = "raw_syscall.img";
const MUST_FAIL_REPORT = `${MUST_FAIL}: main: has syscall and does not read __bun_host.os`;

/**
 * Functions of JavaScriptCore's interpreter: it keeps the number of the opcode in the 4 bytes after the
 * indirect jump that ends a handler. 0x64 and 0x65 are the prefix bytes of fs and gs, so a disassembler
 * that does not know reads "addl %eax, %fs:(%rax)" there.
 */
const INTERPRETER_DATA = /^(llint_|op_|wasm_|ipint_|_?js_trampoline|vmEntry|.*LowLevelInterpreter)/;

function report(name: string, passed: boolean, output: string[]): boolean {
  console.log(`${name}: ${passed ? "passed" : "FAILED"}`);
  if (!passed) for (const line of output) console.log(`    ${line}`);
  return passed;
}

/** What the sysroot has next to the libc: the builtins and crt objects of compiler-rt, and the libraries. */
function otherArchives(ctx: Context): string[] {
  const found: string[] = [];
  const runtime = join(ctx.sysroot.builtins, "..");
  if (existsSync(runtime)) for (const name of readdirSync(runtime).sort()) found.push(join(runtime, name));
  // What `make install` of musl puts next to libc.a are empty archives (libm.a, libpthread.a ...).
  const libraries = ["libc++.a", "libc++abi.a", "libunwind.a", "libicuuc.a", "libicui18n.a"];
  for (const name of libraries) if (existsSync(join(ctx.sysroot.lib, name))) found.push(join(ctx.sysroot.lib, name));
  if (existsSync(ctx.sysroot.memfn)) {
    for (const name of readdirSync(ctx.sysroot.memfn).sort()) found.push(join(ctx.sysroot.memfn, name));
  }
  return found;
}

/**
 * Runs the checks and prints one line for each. Returns whether all of them passed. `wholeSysroot`: also
 * the libraries that a C program does not link.
 */
export async function check(ctx: Context, wholeSysroot: boolean): Promise<boolean> {
  const sysroot = join(ctx.sysroot.root, "usr");
  if (!existsSync(join(ctx.sysroot.lib, "libc.a"))) {
    console.log(`static checks: FAILED, there is no libc in ${ctx.sysroot.root}. Build it first: test-image`);
    return false;
  }
  const images = readdirSync(ctx.out)
    .filter(name => name.endsWith(".img") && name !== MUST_FAIL)
    .sort()
    .map(name => inOut(ctx, name));
  let passed = true;

  if (ctx.arch === "x86_64") {
    const archives = wholeSysroot ? otherArchives(ctx) : [];
    const result = await checkX86_64({
      out: ctx.out,
      sysroot,
      images,
      archives,
      allow: [INTERPRETER_DATA],
      llvm: ctx.llvm,
    });
    for (const line of result.lines) if (line.includes("accepted by --allow")) console.log(`  ${line}`);
    const output = [...result.lines, ...result.errors.map(error => `ERROR ${error}`)];
    const rest = wholeSysroot ? `, ${archives.length} more archives and objects of the sysroot,` : "";
    const name = `x86_64 static checks of the libc${rest} and ${images.length} images`;
    passed = report(name, result.errors.length === 0, output) && passed;

    if (existsSync(inOut(ctx, MUST_FAIL))) {
      const control = await checkX86_64({
        out: ctx.out,
        sysroot,
        images: [inOut(ctx, MUST_FAIL)],
        archives: [],
        allow: [],
        llvm: ctx.llvm,
      });
      const reported = control.errors.includes(MUST_FAIL_REPORT);
      console.log(
        `x86_64 must fail: static checks of an image that issues a syscall itself: ${reported ? "reported" : "NOT REPORTED"}`,
      );
      if (!reported) for (const line of [...control.lines, ...control.errors]) console.log(`    ${line}`);
      passed = reported && passed;
    }
    return passed;
  }

  const builtins = [ctx.sysroot.builtins];
  const archives = wholeSysroot ? otherArchives(ctx).filter(path => path !== ctx.sysroot.builtins) : [];
  const result = await checkAarch64({ out: ctx.out, sysroot, builtins, archives, images, llvm: ctx.llvm });
  const output = [...result.lines, ...result.errors.map(error => `ERROR ${error}`)];
  const rest = wholeSysroot ? `, ${archives.length} more archives and objects of the sysroot,` : "";
  const name = `aarch64 static checks of the libc, the builtins${rest} and ${images.length} images`;
  passed = report(name, result.errors.length === 0, output) && passed;
  for (const image of images) {
    const name = image.slice(ctx.out.length + 1);
    try {
      checkSignature(image);
      console.log(`aarch64 ${name}: the appended Apple code signature is well formed and its hashes match`);
    } catch (error) {
      if (!(error instanceof SignatureError)) throw error;
      console.log(`aarch64 ${name}: Apple code signature check FAILED`);
      console.log(`    ${error.message}`);
      passed = false;
    }
  }
  return passed;
}
