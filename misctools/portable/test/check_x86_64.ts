/**
 * Static checks of the x86_64 sysroot and images, on their disassembly.
 *
 *   bun test/check_x86_64.ts <out dir> [--sysroot <dir with lib/libc.a>] [--image <file>]...
 *                            [--archive <file>]... [--allow <regex>]... [--llvm <bin dir>]
 *
 * Without --sysroot it is <out dir>/sysroot/usr, without --image every <out dir>/*.img.
 *
 * 1. No instruction addresses memory below the stack pointer (the red zone):
 *    "-N(%rsp)". Windows may write there at any time. Checked in libc.a, in
 *    the crt objects and in every image. "lea" computes an address and reads
 *    nothing, it does not count.
 * 2. Every function of libc.a that contains "syscall" also refers to
 *    __bun_host, except the Linux halves of the dispatchers, which are assembly.
 * 3. fs and gs appear only as the two ways of __get_tp, "mov %fs:(%reg),%reg"
 *    and "mov %gs:(%reg),%reg" with the offset of the host table in the
 *    register, in a function that refers to __bun_host. A thread local of the
 *    compiler or a thread pointer read of other code has a constant in place
 *    of the register ("%fs:0x0"). Except the TLS descriptor functions of the
 *    dynamic linker (not in a static image).
 * 4. The Linux halves are referenced by their dispatchers only.
 * 5. Every image, whatever was linked into it: no TLS segment, no "sysenter"
 *    and no "int $0x80", and rules 1 to 3 for every function. Data that sits
 *    between instructions can decode as one of these (the interpreter of
 *    JavaScriptCore keeps opcode numbers after indirect jumps), so a function
 *    outside of the libc that breaks a rule is printed with the bytes, and
 *    --allow <regex of function names> accepts it after it was looked at.
 * 6. Every --archive, which is for what the sysroot has next to the libc (compiler-rt, the C++ runtime,
 *    ICU): no instruction below the stack pointer, no "syscall", "sysenter" or "int $0x80", no fs or gs.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { llvmBin } from "../flags.ts";

export interface Arguments {
  out: string;
  sysroot: string;
  images: string[];
  /** Archives and objects of the sysroot that are not the libc. */
  archives: string[];
  allow: RegExp[];
  llvm: string;
}

/** The lines that the check prints, and the errors. No error: everything is by the rules. */
export interface Result {
  lines: string[];
  errors: string[];
}

/** The arguments of the command line, with what is left out found below the output directory. */
export function parseArguments(argv: string[]): Arguments {
  const [out, ...rest] = argv;
  if (out === undefined) throw new Error("no output directory");
  let llvm: string | undefined;
  let sysroot = join(out, "sysroot", "usr");
  const images: string[] = [];
  const archives: string[] = [];
  const allow: RegExp[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`${rest[i]} needs a value`);
    if (rest[i] === "--llvm") llvm = value;
    else if (rest[i] === "--sysroot") sysroot = value;
    else if (rest[i] === "--image") images.push(value);
    else if (rest[i] === "--archive") archives.push(value);
    else if (rest[i] === "--allow") allow.push(new RegExp(value));
    else throw new Error(`unknown option ${rest[i]}`);
  }
  if (images.length === 0 && existsSync(out)) {
    for (const name of readdirSync(out).sort()) if (name.endsWith(".img")) images.push(join(out, name));
  }
  return { out, sysroot, images, archives, allow, llvm: llvm ?? llvmBin() };
}

const LINUX_HALVES: Record<string, string[]> = {
  __clone_linux: ["__clone"],
  __unmapself_linux: ["__unmapself"],
  __vfork_linux: ["vfork"],
  __syscall_cp_asm: ["__syscall_cp_c"],
  __restore_rt: ["__libc_sigaction"],
};
const DYNAMIC_LINKER_ONLY = new Set(["__tlsdesc_static", "__tlsdesc_dynamic"]);

type Fn = {
  member: string;
  name: string;
  syscall: number;
  fs: number;
  gs: number;
  host: boolean;
  redZone: string[];
  legacy: string[];
  segment: string[];
  refs: Set<string>;
};

async function output(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text;
}

/** Streams the disassembly of a file and hands every function to `each`. */
async function functions(llvm: string, path: string, relocs: boolean, each: (f: Fn) => void): Promise<void> {
  const proc = Bun.spawn([`${llvm}/llvm-objdump`, relocs ? "-dr" : "-d", "--no-show-raw-insn", path], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let rest = "";
  let member = "";
  let current: Fn | null = null;
  const fileFormat = /^(\S.*):\s+file format/;
  const label = /^[0-9a-f]+ <(.+)>:$/;
  const insn = /^\s*[0-9a-f]+:\s+(.*)$/;
  const redZone = /(^|[\s,])-(0x)?[0-9a-f]+\(%rsp\)/;
  const getTp = /^movq\s+%(fs|gs):\(%r[a-z0-9]+\), %r[a-z0-9]+$/;
  const handle = (line: string) => {
    let m = fileFormat.exec(line);
    if (m) {
      const file = m[1]!;
      member = file.includes("(") ? file.slice(file.lastIndexOf("(") + 1).replace(/\)$/, "") : "";
      return;
    }
    m = label.exec(line);
    if (m) {
      if (current) each(current);
      current = {
        member,
        name: m[1]!,
        syscall: 0,
        fs: 0,
        gs: 0,
        host: false,
        redZone: [],
        legacy: [],
        segment: [],
        refs: new Set(),
      };
      return;
    }
    if (!current) return;
    if (line.includes("R_X86_64_")) {
      const symbol = line.trim().split(/\s+/)[2] ?? "";
      const name = symbol.replace(/[-+]0x[0-9a-f]+$/, "");
      current.refs.add(name);
      if (name === "__bun_host") current.host = true;
      return;
    }
    m = insn.exec(line);
    if (!m) return;
    const text = m[1]!;
    if (/^syscall\b/.test(text)) current.syscall++;
    if (/^(sysenter\b|int\s+\$0x80\b)/.test(text)) current.legacy.push(text);
    if (text.includes("%fs:") || text.includes("%gs:")) {
      const way = getTp.exec(text);
      if (!way) current.segment.push(line.trim());
      else if (way[1] === "fs") current.fs++;
      else current.gs++;
    }
    if (text.includes("<__bun_host>") || text.includes("<__bun_host+")) current.host = true;
    if (redZone.test(text) && !/^lea[lq]?\s/.test(text)) current.redZone.push(line.trim());
  };
  for await (const chunk of proc.stdout) {
    const text = rest + decoder.decode(chunk, { stream: true });
    const lines = text.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  if (rest) handle(rest);
  if (current) each(current);
  await proc.exited;
}

export async function checkX86_64(args: Arguments): Promise<Result> {
  const { out, sysroot, images, archives, allow, llvm } = args;
  const lines: string[] = [];
  const errors: string[] = [];

  // ─── sysroot ───
  const lib = join(sysroot, "lib");
  const objects = existsSync(lib)
    ? readdirSync(lib)
        .filter(n => /crt.*\.o$/.test(n))
        .sort()
        .map(n => join(lib, n))
    : [];
  for (const path of objects) {
    let below = 0;
    await functions(llvm, path, false, f => {
      below += f.redZone.length;
      for (const line of f.redZone) errors.push(`${relative(out, path)}: ${f.name}: below the stack pointer: ${line}`);
    });
    lines.push(`red zone: ${below} instructions address memory below %rsp in ${relative(out, path)}`);
  }

  const libc = join(lib, "libc.a");
  {
    let withSyscall = 0,
      guarded = 0,
      readers = 0,
      below = 0;
    const callers: Record<string, Set<string>> = {};
    for (const half of Object.keys(LINUX_HALVES)) callers[half] = new Set();
    await functions(llvm, libc, true, f => {
      const where = `libc.a: ${f.member} ${f.name}`;
      below += f.redZone.length;
      for (const line of f.redZone) errors.push(`${where}: below the stack pointer: ${line}`);
      for (const text of f.legacy) errors.push(`${where}: ${text}`);
      if (f.syscall) {
        withSyscall++;
        if (f.name in LINUX_HALVES) {
        } else if (f.host) guarded++;
        else errors.push(`${where} has syscall and no reference to __bun_host`);
      }
      if (f.fs || f.gs) {
        readers++;
        if (!f.host) errors.push(`${where} reads the thread pointer and does not refer to __bun_host`);
      }
      if (!DYNAMIC_LINKER_ONLY.has(f.name))
        for (const line of f.segment) errors.push(`${where}: fs or gs in another way than __get_tp: ${line}`);
      for (const half of Object.keys(LINUX_HALVES)) if (f.refs.has(half)) callers[half]!.add(f.name);
    });
    lines.push(`red zone: ${below} instructions address memory below %rsp in libc.a`);
    lines.push(
      `syscall: ${withSyscall} functions of libc.a, ${guarded} refer to __bun_host, ${withSyscall - guarded} do not (Linux halves, or errors below)`,
    );
    lines.push(
      `thread pointer: ${readers} functions of libc.a read it, all of them in the two ways of __get_tp (or errors below)`,
    );
    let halvesOk = true;
    for (const [half, allowed] of Object.entries(LINUX_HALVES)) {
      const got = [...callers[half]!].sort();
      if (got.join(",") !== [...allowed].sort().join(",")) {
        halvesOk = false;
        errors.push(`libc.a: ${half} is referenced by [${got.join(", ")}], expected [${allowed.join(", ")}]`);
      }
    }
    if (halvesOk) lines.push("Linux halves: referenced by their dispatchers only");
  }

  // ─── the rest of the sysroot ───
  for (const path of archives) {
    const before = errors.length;
    let total = 0;
    await functions(llvm, path, false, f => {
      total++;
      const where = `${relative(out, path)}: ${f.member} ${f.name}`;
      for (const line of f.redZone) errors.push(`${where}: below the stack pointer: ${line}`);
      for (const text of f.legacy) errors.push(`${where}: ${text}`);
      if (f.syscall) errors.push(`${where}: has syscall`);
      if (f.fs || f.gs) errors.push(`${where}: reads the thread pointer`);
      for (const line of f.segment) errors.push(`${where}: fs or gs: ${line}`);
    });
    if (errors.length === before) {
      lines.push(`${relative(out, path)}: ${total} functions, none below %rsp, none with syscall, fs or gs`);
    }
  }

  // ─── images ───
  for (const path of images) {
    const image = relative(out, path);
    const before = errors.length;
    const headers = await output([`${llvm}/llvm-readelf`, "-lW", path]);
    if (/^\s*TLS\s/m.test(headers)) errors.push(`${image}: has a TLS segment`);
    let total = 0,
      withSyscall = 0,
      readers = 0,
      below = 0;
    const allowed: string[] = [];
    await functions(llvm, path, false, f => {
      total++;
      const problems: string[] = [];
      below += f.redZone.length;
      for (const line of f.redZone) problems.push(`below the stack pointer: ${line}`);
      for (const text of f.legacy) problems.push(text);
      if (f.syscall) {
        withSyscall++;
        if (!(f.name in LINUX_HALVES) && !f.host) problems.push(`has syscall and does not read __bun_host.os`);
      }
      if (f.fs || f.gs) {
        readers++;
        if (!f.host) problems.push(`reads the thread pointer and does not read __bun_host`);
      }
      for (const line of f.segment) problems.push(`fs or gs in another way than __get_tp: ${line}`);
      if (problems.length === 0) return;
      if (allow.some(r => r.test(f.name))) allowed.push(`${f.name}: ${problems.join("; ")}`);
      else for (const p of problems) errors.push(`${image}: ${f.name}: ${p}`);
    });
    for (const line of allowed) lines.push(`${image}: accepted by --allow: ${line}`);
    if (errors.length === before)
      lines.push(
        `${image}: no TLS segment, ${total} functions, ${withSyscall} with syscall and ${readers} that read the thread pointer, ${below} instructions below %rsp, all by the rules`,
      );
  }

  return { lines, errors };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    process.stderr.write(
      "usage: bun test/check_x86_64.ts <out dir> [--sysroot <dir>] [--image <file>]... [--archive <file>]... [--allow <regex>]... [--llvm <bin dir>]\n",
    );
    process.exit(2);
  }
  const result = await checkX86_64(parseArguments(argv));
  for (const line of result.lines) console.log(line);
  for (const error of result.errors) console.log("ERROR", error);
  process.exit(result.errors.length > 0 ? 1 : 0);
}
