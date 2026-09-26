/**
 * Static checks of the aarch64 sysroot and images, on their disassembly.
 *
 *   bun test/check_aarch64.ts <out dir> [--sysroot <dir with lib/libc.a>] [--builtins <archive>]...
 *                             [--archive <file>]... [--image <file>]... [--llvm <bin dir>]
 *
 * Without --sysroot it is <out dir>/sysroot/usr, without --builtins the archives of the sysroot's clang
 * resource directory, without --image every <out dir>/*.img.
 *
 * 1. x18 is never written: the only instruction that names x18 or w18 is
 *    "mov xN, x18" (the Windows way of __get_tp). Checked in libc.a, in the
 *    compiler-rt builtins, in the crt objects and in every image.
 * 2. Every function of libc.a that contains "svc" also refers to __bun_host,
 *    except the Linux halves of the dispatchers, which are assembly.
 * 3. tpidr_el0 is written in __set_thread_area only, and a function that reads
 *    it reads tpidrro_el0 and x18 as often (the three ways of __get_tp), except
 *    __tlsdesc_dynamic (dynamic linker, not in a static image).
 * 4. The Linux halves are referenced by their dispatchers only.
 * 5. Every image, whatever was linked into it: no TLS segment (the compiler
 *    would read tpidr_el0 for it), and rules 2 and 3 for every function, where
 *    "refers to __bun_host" is an adrp to its page and a load at its offset.
 * 6. Every --archive, which is for what the sysroot has next to the libc and the builtins (the C++
 *    runtime, ICU): x18 is not written (an instruction that names it is "mov xN, x18" or stores it to
 *    memory), no "svc", no read or write of a thread register.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { llvmBin } from "../flags.ts";

const LINUX_HALVES: Record<string, string[]> = {
  __clone_linux: ["__clone"],
  __unmapself_linux: ["__unmapself"],
  __vfork_linux: ["vfork"],
  __syscall_cp_asm: ["__syscall_cp_c"],
  __restore_rt: ["__libc_sigaction"],
  __restore: ["__libc_sigaction"],
};

/** What the rules ask about one function: the instructions of every piece of code under its name. */
interface Fn {
  member: string;
  name: string;
  svc: number;
  tpidr: number;
  tpidrro: number;
  /** Instructions that start with "mov xN, x18". */
  x18: number;
  /** Instructions that are "mov xN, x18" and nothing else. */
  x18Reads: number;
  /** An instruction that writes tpidr_el0 or tpidrro_el0. */
  writesThreadRegister: boolean;
  /** The text "__bun_host" in an instruction or a relocation. */
  namesHost: boolean;
  /** Instructions that name x18 or w18 and are not "mov xN, x18". */
  otherX18: string[];
  /** Those of `otherX18` that store x18 to memory and change no register: str and stp without writeback. */
  storesOfX18: string[];
  /** The Linux halves that a relocation of the function refers to. */
  halves: Set<string>;
  adrpToHostPage: boolean;
  loadAtHostOffset: boolean;
}

export interface Arguments {
  out: string;
  sysroot: string;
  builtins: string[];
  /** Archives and objects of the sysroot that are neither the libc nor the builtins. */
  archives: string[];
  images: string[];
  llvm: string;
}

/** The lines that the check prints, and the errors. No error: everything is by the rules. */
export interface Result {
  lines: string[];
  errors: string[];
}

async function output(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const [text] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return text;
}

/**
 * The functions of a file in the order of its disassembly. Code under one name in one archive member is
 * one function, wherever its pieces are. `host` is the address of __bun_host in a linked image.
 */
async function functions(llvm: string, path: string, relocations: boolean, host?: number): Promise<Fn[]> {
  const proc = Bun.spawn([join(llvm, "llvm-objdump"), relocations ? "-dr" : "-d", "--no-show-raw-insn", path], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const found = new Map<string, Fn>();
  const fileFormat = /^(\S.*):\s+file format/;
  const label = /^[0-9a-f]+ <(.+)>:$/;
  const instruction = /^\s*[0-9a-f]+:\s/;
  const address = /^\s*[0-9a-f]+:\s+/;
  const halves = Object.keys(LINUX_HALVES).map(half => ({
    half,
    reference: new RegExp(`R_AARCH64_\\w+\\s+${half}\\b`),
  }));
  const adrp =
    host === undefined ? undefined : new RegExp(`^adrp\\tx\\d+, 0x${(host - (host % 4096)).toString(16)}\\b`);
  const load =
    host === undefined ? undefined : new RegExp(`^ldr\\tx\\d+, \\[x\\d+, #0x${(host % 4096).toString(16)}\\]`);
  let member = "";
  let current: Fn | undefined;

  const handle = (line: string) => {
    let m = fileFormat.exec(line);
    if (m !== null) {
      const name = m[1]!;
      member = name.slice(name.lastIndexOf("(") + 1).replace(/\)+$/, "");
      if (current !== undefined) current = entry(current.name);
      return;
    }
    m = label.exec(line);
    if (m !== null) {
      current = entry(m[1]!);
      return;
    }
    if (current === undefined || !(instruction.test(line) || line.includes("R_AARCH64_"))) return;
    const text = line.trim().replace(address, "");
    if (text.startsWith("svc\t")) current.svc++;
    if (/^mrs\tx\d+, TPIDR_EL0/.test(text)) current.tpidr++;
    if (/^mrs\tx\d+, TPIDRRO_EL0/.test(text)) current.tpidrro++;
    if (/^mov\tx\d+, x18/.test(text)) current.x18++;
    if (text.startsWith("msr\tTPIDR")) current.writesThreadRegister = true;
    if (text.includes("__bun_host")) current.namesHost = true;
    if (/^mov\tx\d+, x18$/.test(text)) current.x18Reads++;
    else if (/\b[xw]18\b/.test(text)) {
      current.otherX18.push(text);
      if (/^(str|stp)\t[^[]*\b[xw]18\b[^[]*\[(?![^\]]*\b[xw]18\b)[^\]]*\]$/.test(text)) current.storesOfX18.push(text);
    }
    for (const { half, reference } of halves) if (reference.test(text)) current.halves.add(half);
    if (adrp?.test(text)) current.adrpToHostPage = true;
    if (load?.test(text)) current.loadAtHostOffset = true;
  };
  const entry = (name: string): Fn => {
    const key = `${member}\0${name}`;
    let fn = found.get(key);
    if (fn === undefined) {
      fn = {
        member,
        name,
        svc: 0,
        tpidr: 0,
        tpidrro: 0,
        x18: 0,
        x18Reads: 0,
        writesThreadRegister: false,
        namesHost: false,
        otherX18: [],
        storesOfX18: [],
        halves: new Set(),
        adrpToHostPage: false,
        loadAtHostOffset: false,
      };
      found.set(key, fn);
    }
    return fn;
  };

  const decoder = new TextDecoder("utf-8", { fatal: false });
  // The characters that end a line for Python's splitlines(), which the first version of this check used.
  const newline = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
  let rest = "";
  for await (const chunk of proc.stdout) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split(newline);
    rest = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  if (rest !== "") handle(rest);
  await proc.exited;
  return [...found.values()];
}

/** The way Python prints a list of names, which is how the first version of this check printed them. */
const list = (names: string[]) => `[${names.map(name => `'${name}'`).join(", ")}]`;

export async function checkAarch64(args: Arguments): Promise<Result> {
  const lines: string[] = [];
  const errors: string[] = [];
  const lib = join(args.sysroot, "lib");
  const libc = join(lib, "libc.a");
  const crt = existsSync(lib)
    ? readdirSync(lib)
        .filter(name => !name.startsWith(".") && name.includes("crt") && name.endsWith(".o"))
        .sort()
        .map(name => join(lib, name))
    : [];

  for (const path of [libc, ...crt, ...args.builtins, ...args.images]) {
    let reads = 0;
    let others = 0;
    for (const fn of await functions(args.llvm, path, false)) {
      reads += fn.x18Reads;
      for (const text of fn.otherX18) {
        others++;
        errors.push(`${path}: ${fn.member} ${fn.name}: x18 in '${text}'`);
      }
    }
    lines.push(`x18: ${String(reads).padStart(4)} reads, ${others} other uses, in ${relative(args.out, path)}`);
  }

  let withSvc = 0;
  let guarded = 0;
  let readers = 0;
  const callers = new Map<string, Set<string>>(Object.keys(LINUX_HALVES).map(half => [half, new Set()]));
  for (const fn of await functions(args.llvm, libc, true)) {
    if (fn.writesThreadRegister && fn.name !== "__set_thread_area") {
      errors.push(`libc.a: ${fn.member} ${fn.name} writes a thread register`);
    }
    if (fn.svc > 0) {
      withSvc++;
      if (fn.name in LINUX_HALVES) {
        // the Linux half of a dispatcher
      } else if (fn.namesHost) guarded++;
      else errors.push(`libc.a: ${fn.member} ${fn.name} has svc and no reference to __bun_host`);
    }
    if (fn.tpidr > 0 || fn.tpidrro > 0 || fn.x18 > 0) {
      readers++;
      const threeWays = fn.tpidr === fn.tpidrro && fn.tpidrro === fn.x18 && fn.namesHost;
      if (!threeWays && fn.name !== "__tlsdesc_dynamic") {
        errors.push(
          `libc.a: ${fn.member} ${fn.name} reads tpidr_el0 ${fn.tpidr}, tpidrro_el0 ${fn.tpidrro}, x18 ${fn.x18} times`,
        );
      }
    }
    for (const half of fn.halves) callers.get(half)!.add(fn.name);
  }
  lines.push(
    `svc: ${withSvc} functions of libc.a, ${guarded} refer to __bun_host, ${withSvc - guarded} do not (Linux halves, or errors below)`,
  );
  lines.push(`thread register: ${readers} functions of libc.a read it (the three ways, or errors below)`);
  let halvesByTheRules = true;
  for (const [half, allowed] of Object.entries(LINUX_HALVES)) {
    const got = [...callers.get(half)!].sort();
    if (got.join() !== [...allowed].sort().join()) {
      halvesByTheRules = false;
      errors.push(`libc.a: ${half} is referenced by ${list(got)}, expected ${list([...allowed].sort())}`);
    }
  }
  if (halvesByTheRules) lines.push("Linux halves: referenced by their dispatchers only");

  for (const path of args.archives) {
    const before = errors.length;
    const all = await functions(args.llvm, path, false);
    for (const fn of all) {
      const where = `${relative(args.out, path)}: ${fn.member} ${fn.name}`;
      for (const text of fn.otherX18) {
        if (!fn.storesOfX18.includes(text)) errors.push(`${where}: x18 in '${text}'`);
      }
      if (fn.svc > 0) errors.push(`${where}: has svc`);
      if (fn.tpidr > 0 || fn.tpidrro > 0 || fn.writesThreadRegister) errors.push(`${where}: uses a thread register`);
    }
    if (errors.length === before) {
      lines.push(
        `${relative(args.out, path)}: ${all.length} functions, none writes x18, none with svc or a thread register`,
      );
    }
  }

  for (const path of args.images) {
    const image = relative(args.out, path);
    const before = errors.length;
    const headers = await output([join(args.llvm, "llvm-readelf"), "-lW", path]);
    if (/^\s*TLS\s/m.test(headers)) errors.push(`${image}: has a TLS segment`);
    const symbols = await output([join(args.llvm, "llvm-nm"), path]);
    const host = /^([0-9a-f]+) \w __bun_host$/m.exec(symbols);
    if (host === null) {
      errors.push(`${image}: no symbol __bun_host`);
      continue;
    }
    let imageWithSvc = 0;
    let imageReaders = 0;
    for (const fn of await functions(args.llvm, path, false, parseInt(host[1]!, 16))) {
      const readsHost = fn.adrpToHostPage && fn.loadAtHostOffset;
      if (fn.writesThreadRegister && fn.name !== "__set_thread_area") {
        errors.push(`${image}: ${fn.name} writes a thread register`);
      }
      if (fn.svc > 0) {
        imageWithSvc++;
        if (!(fn.name in LINUX_HALVES) && !readsHost)
          errors.push(`${image}: ${fn.name} has svc and does not read __bun_host.os`);
      }
      if (fn.tpidr > 0 || fn.tpidrro > 0 || fn.x18 > 0) {
        imageReaders++;
        if (!(fn.tpidr === fn.tpidrro && fn.tpidrro === fn.x18 && readsHost)) {
          errors.push(
            `${image}: ${fn.name} reads tpidr_el0 ${fn.tpidr}, tpidrro_el0 ${fn.tpidrro}, x18 ${fn.x18} times`,
          );
        }
      }
    }
    if (errors.length === before) {
      lines.push(
        `${image}: no TLS segment, ${imageWithSvc} functions with svc and ${imageReaders} that read the thread register, all by the rules`,
      );
    }
  }
  return { lines, errors };
}

/** The arguments of the command line, with what is left out found below the output directory. */
export function parseArguments(argv: string[]): Arguments {
  const [out, ...rest] = argv;
  if (out === undefined) throw new Error("no output directory");
  let sysroot = join(out, "sysroot", "usr");
  let llvm: string | undefined;
  const builtins: string[] = [];
  const archives: string[] = [];
  const images: string[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`${rest[i]} needs a value`);
    if (rest[i] === "--llvm") llvm = value;
    else if (rest[i] === "--sysroot") sysroot = value;
    else if (rest[i] === "--builtins") builtins.push(value);
    else if (rest[i] === "--archive") archives.push(value);
    else if (rest[i] === "--image") images.push(value);
    else throw new Error(`unknown option ${rest[i]}`);
  }
  if (builtins.length === 0) {
    const lib = join(out, "sysroot", "clang-resource-dir", "lib", "aarch64-unknown-linux-musl");
    if (existsSync(lib))
      for (const name of readdirSync(lib).sort()) if (name.endsWith(".a")) builtins.push(join(lib, name));
  }
  if (images.length === 0 && existsSync(out)) {
    for (const name of readdirSync(out).sort()) if (name.endsWith(".img")) images.push(join(out, name));
  }
  return { out, sysroot, builtins, archives, images, llvm: llvm ?? llvmBin() };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    process.stderr.write(
      "usage: bun test/check_aarch64.ts <out dir> [--sysroot <dir>] [--builtins <archive>]... [--archive <file>]... [--image <file>]... [--llvm <bin dir>]\n",
    );
    process.exit(2);
  }
  const result = await checkAarch64(parseArguments(argv));
  for (const line of result.lines) console.log(line);
  for (const error of result.errors) console.log("ERROR", error);
  process.exit(result.errors.length > 0 ? 1 : 0);
}
