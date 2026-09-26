// Static checks of aarch64 images and archives, on their disassembly.
//
//   bun test/check_aarch64.ts [--image <file>]... [--archive <file>]... [--sysroot <dir>]
//                             [--map <lld map of the first image>] [--llvm <bin dir>] [--out <json>]
//                             [--expect-x18-writes] [--self-test]
//
//   --sysroot   every archive and every crt object under <dir>/usr/lib and under
//               <dir>/clang-resource-dir/lib is checked, linked into an image or not
//   --map       default: <image>.map if it is there. With a map every finding names the
//               archive that the code came from.
//   --expect-x18-writes   for a negative control: the check passes only if it FINDS writes
//
// 1. x18 is never written. An instruction that names x18 or w18 is a write unless it is of
//    a kind that this tool knows as a read (classify() below). What the tool does not know
//    counts as a write, so a new kind of instruction can make the check fail, and cannot
//    make it pass.
// 2. Images: no TLS segment (the compiler would read tpidr_el0 for it).
// 3. Images: a function that has "svc" reads __bun_host.os, or is one of the Linux halves
//    of the libc.
// 4. Images: tpidr_el0 is written in __set_thread_area only, and a function that reads it
//    reads tpidrro_el0 and x18 as often (the three ways of __get_tp).
// 5. Images: every register of the system that is read or written (mrs, msr) and every
//    instruction for the caches (dc, ic, sys) is listed with the functions that have it.
//    A register that only a kernel can answer for (the ID registers: Linux emulates the
//    read, other systems do not) fails the check.
// 6. Words of data between the instructions (the interpreter of JavaScriptCore keeps the
//    number of an opcode after the jump that ends its handler): each has to follow an
//    instruction that does not go on to the next one, and its value has to be below
//    0x10000, which as an instruction is "udf": it traps and writes nothing.
// The port of test/check_aarch64.py, which is for the small test images: its first rule
// reports every use of x18 that is not "mov xN, x18", and JavaScriptCore has other reads.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// ---- rule 1: does an instruction write x18 ----
const READS_ALL = new Set([
  "cmp", "cmn", "tst", "ccmp", "ccmn", "cbz", "cbnz", "tbz", "tbnz", "br", "blr", "ret", "msr", "prfm", "prfum",
  "braa", "brab", "blraa", "blrab", "braaz", "brabz", "blraaz", "blrabz", "sys", "dc", "ic", "at", "tlbi",
]);
const STORE = /^(st[ul]?r[bh]?|stlur[bh]?|sttr[bh]?|stn?p|st64b)$/;
const STORE_EXCLUSIVE = /^stl?x[rp][bh]?$/;
const LOAD_PAIR = /^(ldn?p|ldpsw|lda?xp)$/;
const COMPARE_AND_SWAP_PAIR = /^caspa?l?$/;
const COMPARE_AND_SWAP = /^casa?l?[bh]?$/;
const ATOMIC_IN_MEMORY = /^(swp|ldadd|ldclr|ldeor|ldset|ldsmax|ldsmin|ldumax|ldumin)a?l?[bh]?$/;

function operandsOf(text: string): string[] {
  const out: string[] = [];
  let depth = 0, current = "";
  for (const c of text) {
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += c;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function classify(mnemonic: string, operandText: string): "none" | "read" | "write" {
  const text = operandText.replace(/\s*\/\/.*$/, "").replace(/<[^>]*>/g, "");
  if (!/\b[xw]18\b/.test(text)) {
    // Eight registers from the first one: LS64 names the first only.
    if (mnemonic === "ld64b" && /^x1[1-7]\b/.test(text)) return "write";
    return "none";
  }
  // The base register of an address is written when the address is written back.
  if (/\[x18[^\]]*\]!/.test(text) || /\[x18\]\s*,/.test(text) || /\b[xw]18\]?!/.test(text)) return "write";
  const m = mnemonic.toLowerCase();
  const operands = operandsOf(text);
  let written: number[];
  if (READS_ALL.has(m) || m.startsWith("b.")) written = [];
  else if (STORE.test(m)) written = [];
  else if (STORE_EXCLUSIVE.test(m)) written = [0];
  else if (LOAD_PAIR.test(m) || COMPARE_AND_SWAP_PAIR.test(m)) written = [0, 1];
  else if (COMPARE_AND_SWAP.test(m)) written = [0];
  else if (ATOMIC_IN_MEMORY.test(m)) written = [1];
  else written = [0];
  return written.some(i => operands[i] !== undefined && /^[xw]18$/.test(operands[i])) ? "write" : "read";
}

const SELF_TEST: [string, string, "none" | "read" | "write"][] = [
  ["mov", "x8, x18", "read"], ["mov", "x18, x8", "write"], ["mov", "w18, #0x1", "write"], ["movz", "x18, #0xbad", "write"],
  ["ldr", "x18, [x0]", "write"], ["ldr", "x0, [x18, #0x10]", "read"], ["ldr", "x0, [x18], #8", "write"], ["ldr", "x0, [x18, #8]!", "write"],
  ["ldr", "x0, [x1, x18, lsl #3]", "read"], ["ldp", "x18, x19, [x0, #0x90]", "write"], ["ldp", "x17, x18, [x0]", "write"],
  ["ldp", "x19, x20, [x18]", "read"], ["ldp", "q0, q1, [x18], #32", "write"], ["stp", "x18, x19, [sp, #0x90]", "read"],
  ["stp", "x18, x19, [sp, #-16]!", "read"], ["stp", "x29, x30, [x18, #-16]!", "write"], ["str", "x18, [sp, #16]", "read"],
  ["str", "x0, [x18], #8", "write"], ["stxr", "w18, x0, [x1]", "write"], ["stxr", "w0, x18, [x1]", "read"], ["stlxr", "w9, x10, [x18]", "read"],
  ["add", "x18, x18, #0x1", "write"], ["add", "x0, x18, #0x1", "read"], ["adrp", "x18, 0x1000", "write"], ["cmp", "x18, x0", "read"],
  ["cbz", "x18, 0x40", "read"], ["tbnz", "w18, #0x3, 0x40", "read"], ["blr", "x18", "read"], ["msr", "TPIDR_EL0, x18", "read"],
  ["mrs", "x18, TPIDR_EL0", "write"], ["fmov", "x18, d0", "write"], ["fmov", "d0, x18", "read"], ["fcvtzs", "w18, d1", "write"],
  ["umov", "w18, v0.b[0]", "write"], ["csel", "x0, x18, x1, eq", "read"], ["csel", "x18, x0, x1, eq", "write"],
  ["cas", "x18, x0, [x1]", "write"], ["cas", "x0, x18, [x1]", "read"], ["casp", "x18, x19, x2, x3, [x0]", "write"],
  ["casal", "w18, w0, [x1]", "write"], ["swpal", "x18, x0, [x1]", "read"], ["swpal", "x0, x18, [x1]", "write"],
  ["ldaddal", "x0, x18, [x1]", "write"], ["ldaddal", "x18, x0, [x1]", "read"], ["ld64b", "x12, [x0]", "write"], ["ld64b", "x0, [x1]", "none"],
  ["dc", "zva, x18", "read"], ["prfm", "pldl1keep, [x18]", "read"], ["ldr", "x0, [x17, #0x18]", "none"], ["mov", "x0, #0x18", "none"],
  ["ld1", "{ v0.16b }, [x18], #16", "write"], ["st1", "{ v0.16b }, [x18]", "read"], ["b.eq", "0x18", "none"], ["ldxr", "x18, [x0]", "write"],
  ["ldaxp", "x0, x18, [x1]", "write"], ["sxtw", "x18, w0", "write"], ["bl", "0x1234 <x18_helper>", "none"],
];
function selfTest(): number {
  let failed = 0;
  for (const [mnemonic, operands, want] of SELF_TEST) {
    const got = classify(mnemonic, operands);
    if (got !== want) {
      failed++;
      console.log(`self test FAILED: "${mnemonic} ${operands}" is ${got}, expected ${want}`);
    }
  }
  console.log(`self test: ${SELF_TEST.length - failed} of ${SELF_TEST.length} instructions classified as expected`);
  return failed;
}

// ---- the other rules ----
const LINUX_HALVES = new Set(["__clone_linux", "__unmapself_linux", "__vfork_linux", "__syscall_cp_asm", "__restore_rt", "__restore"]);
// Registers that code outside of a kernel reads on every system. CTR_EL0: the libc reads
// it on Linux only (__clear_cache), so it is asked for by name below.
const REGISTERS_OF_EVERYWHERE = new Set(["TPIDR_EL0", "TPIDRRO_EL0", "FPCR", "FPSR", "NZCV", "DCZID_EL0"]);
// Registers that are used in one place, which runs under a condition that is written down here.
const REGISTERS_UNDER_A_CONDITION = new Map([
  ["CTR_EL0", { functions: new Set(["__clear_cache"]), when: "the host is Linux (__bun_host.os), other hosts get the request clear_cache" }],
  ["TPIDR2_EL0", { functions: new Set(["__libunwind_Registers_arm64_za_disable"]), when: "AT_HWCAP2 has SME (libunwind, checkHasSME), which no host of another system sets" }],
]);

type Origin = { start: number; end: number; file: string };
function readMap(path: string): Origin[] {
  const origins: Origin[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)\s+\d+\s+(\S.*):\(\.[^)]*\)$/.exec(line);
    if (!m || m[2] === "0") continue;
    const start = parseInt(m[1], 16);
    origins.push({ start, end: start + parseInt(m[2], 16), file: m[3] });
  }
  return origins.sort((a, b) => a.start - b.start);
}
function originOf(origins: Origin[], address: number): string {
  let low = 0, high = origins.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (origins[mid].end <= address) low = mid + 1;
    else if (origins[mid].start > address) high = mid - 1;
    else {
      const file = origins[mid].file;
      const archive = /([^/]+\.a)\(([^)]+)\)$/.exec(file);
      return archive ? `${archive[1]}(${archive[2]})` : basename(file);
    }
  }
  return "?";
}
const archiveOf = (origin: string) => origin.replace(/\(.*$/, "");

type Finding = { at: string; function: string; origin: string; instruction: string };
type Result = {
  file: string;
  instructions: number;
  x18_reads: number;
  x18_reads_by_kind: Record<string, number>;
  x18_reads_by_origin: Record<string, number>;
  x18_writes: Finding[];
  data_words: number;
  data_words_that_could_run: Finding[];
  tls_segment?: boolean;
  functions_with_svc?: number;
  functions_that_read_the_thread_register?: number;
  system_registers?: Record<string, { reads: number; writes: number; functions: string[]; origins: string[]; only_when?: string }>;
  cache_instructions?: Record<string, { count: number; functions: string[]; origins: string[] }>;
  errors: string[];
};

async function check(file: string, llvm: string, isImage: boolean, mapPath: string | undefined): Promise<Result> {
  const origins = mapPath && existsSync(mapPath) ? readMap(mapPath) : [];
  const result: Result = { file, instructions: 0, x18_reads: 0, x18_reads_by_kind: {}, x18_reads_by_origin: {}, x18_writes: [], data_words: 0, data_words_that_could_run: [], errors: [] };
  let before = "", beforeOperands = "";
  const registers = new Map<string, { reads: number; writes: number; functions: Set<string>; origins: Set<string> }>();
  const caches = new Map<string, { count: number; functions: Set<string>; origins: Set<string> }>();
  let hostPage = "", hostLow = "";
  if (isImage) {
    const headers = Bun.spawnSync([`${llvm}/llvm-readelf`, "-lW", file]).stdout.toString();
    result.tls_segment = /^\s*TLS\s/m.test(headers);
    if (result.tls_segment) result.errors.push("has a TLS segment");
    const symbols = Bun.spawnSync([`${llvm}/llvm-nm`, file]).stdout.toString();
    const host = /^([0-9a-f]+) \w __bun_host$/m.exec(symbols);
    if (!host) result.errors.push("no symbol __bun_host: is this an image of the portable libc?");
    else {
      const at = parseInt(host[1], 16);
      hostPage = `0x${(at - (at % 4096)).toString(16)}`;
      hostLow = `0x${(at % 4096).toString(16)}`;
    }
    result.functions_with_svc = 0;
    result.functions_that_read_the_thread_register = 0;
  }

  let member = "", name = "", start = 0;
  let svc = 0, tp = 0, ro = 0, x18tp = 0, tpWrites = 0, sawPage = false, sawLoad = false;
  const endFunction = () => {
    if (!isImage || !name) return;
    const readsHost = sawPage && sawLoad;
    if (tpWrites && name !== "__set_thread_area") result.errors.push(`${name} writes a thread register`);
    if (svc) {
      result.functions_with_svc!++;
      if (!LINUX_HALVES.has(name) && !readsHost) result.errors.push(`${name} (${originOf(origins, start)}) has svc and does not read __bun_host.os`);
    }
    if (tp || ro) {
      result.functions_that_read_the_thread_register!++;
      if (!(tp === ro && ro === x18tp && readsHost)) result.errors.push(`${name} (${originOf(origins, start)}) reads tpidr_el0 ${tp}, tpidrro_el0 ${ro}, x18 ${x18tp} times`);
    }
  };
  const pageLoad = new RegExp(`^x\\d+, ${hostPage}\\b`);
  const lowLoad = new RegExp(`^x\\d+, \\[x\\d+, #${hostLow}\\]`);

  const proc = Bun.spawn([`${llvm}/llvm-objdump`, "-d", "--no-show-raw-insn", "--print-imm-hex", file], { stdout: "pipe", stderr: "ignore" });
  const decoder = new TextDecoder();
  let rest = "";
  const onLine = (line: string) => {
    if (line.charCodeAt(0) !== 32) {
      const label = /^([0-9a-f]+) <(.+)>:$/.exec(line);
      if (label) {
        endFunction();
        name = label[2];
        start = parseInt(label[1], 16);
        svc = tp = ro = x18tp = tpWrites = 0;
        sawPage = sawLoad = false;
        return;
      }
      const archive = /^(\S.*):\s+file format/.exec(line);
      if (archive) member = archive[1].includes("(") ? archive[1].slice(archive[1].lastIndexOf("(") + 1).replace(/\)$/, "") : "";
      return;
    }
    // "  address: [bytes] <tab> mnemonic <tab> operands". The bytes are there for data only.
    const fields = line.split("\t");
    const head = /^\s*([0-9a-f]+):/.exec(fields[0]);
    if (!head || fields.length < 2) return;
    const ins = [line, head[1], fields[1].trim(), fields.slice(2).join("\t").trim()];
    const mnemonic = ins[2], operands = ins[3];
    const address = parseInt(ins[1], 16);
    const origin = () => (isImage ? originOf(origins, address) : member);
    if (mnemonic.startsWith(".") || mnemonic === "<unknown>") {
      result.data_words++;
      const value = mnemonic === ".word" ? parseInt(operands, 16) : NaN;
      const goesOn = !/^(b|br|ret|udf|brk|\.word|braa|brab|retaa|retab)$/.test(before) && !(before === "bl" && /llint_crash|abort|_exit|crash/i.test(beforeOperands));
      if (!(value < 0x10000) || (isImage && goesOn)) result.data_words_that_could_run.push({ at: ins[1], function: name, origin: origin(), instruction: `${mnemonic} ${operands} after "${before} ${beforeOperands}"` });
      before = mnemonic;
      return;
    }
    before = mnemonic;
    beforeOperands = operands;
    result.instructions++;
    const kind = classify(mnemonic, operands);
    if (kind === "write") result.x18_writes.push({ at: ins[1], function: name, origin: origin(), instruction: `${mnemonic} ${operands}` });
    else if (kind === "read") {
      result.x18_reads++;
      const shape = `${mnemonic} ${operands.replace(/\s*\/\/.*$/, "").replace(/\b[xw](?!18\b)\d+\b/g, "xN").replace(/#-?(0x)?[0-9a-f]+/g, "#n")}`;
      result.x18_reads_by_kind[shape] = (result.x18_reads_by_kind[shape] ?? 0) + 1;
      const from = archiveOf(origin());
      result.x18_reads_by_origin[from] = (result.x18_reads_by_origin[from] ?? 0) + 1;
    }
    if (!isImage) return;
    if (mnemonic === "svc") svc++;
    else if (mnemonic === "adrp" && pageLoad.test(operands)) sawPage = true;
    else if (mnemonic === "ldr" && lowLoad.test(operands)) sawLoad = true;
    else if (mnemonic === "mov" && /^x\d+, x18$/.test(operands)) x18tp++;
    if (mnemonic === "mrs" || mnemonic === "msr") {
      const parts = operandsOf(operands);
      const register = (mnemonic === "mrs" ? parts[1] : parts[0]).toUpperCase();
      if (register === "TPIDR_EL0") mnemonic === "mrs" ? tp++ : tpWrites++;
      if (register === "TPIDRRO_EL0") mnemonic === "mrs" ? ro++ : tpWrites++;
      const entry = registers.get(register) ?? { reads: 0, writes: 0, functions: new Set<string>(), origins: new Set<string>() };
      mnemonic === "mrs" ? entry.reads++ : entry.writes++;
      if (entry.functions.size < 40) entry.functions.add(name);
      entry.origins.add(archiveOf(origin()));
      registers.set(register, entry);
    } else if (mnemonic === "dc" || mnemonic === "ic" || mnemonic === "sys" || mnemonic === "sysl") {
      const what = `${mnemonic} ${operandsOf(operands)[0]}`;
      const entry = caches.get(what) ?? { count: 0, functions: new Set<string>(), origins: new Set<string>() };
      entry.count++;
      if (entry.functions.size < 40) entry.functions.add(name);
      entry.origins.add(archiveOf(origin()));
      caches.set(what, entry);
    }
  };
  for await (const chunk of proc.stdout) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
    rest = lines.pop()!;
    for (const line of lines) onLine(line);
  }
  if (rest) onLine(rest);
  endFunction();
  if ((await proc.exited) !== 0) result.errors.push("llvm-objdump failed");
  // An archive may be data only (the data of ICU). An image without code was not read.
  if (!result.instructions && isImage) result.errors.push("no instruction was read");

  if (isImage) {
    result.system_registers = {};
    for (const [register, entry] of [...registers].sort()) {
      const known = REGISTERS_UNDER_A_CONDITION.get(register);
      result.system_registers[register] = { reads: entry.reads, writes: entry.writes, functions: [...entry.functions].sort(), origins: [...entry.origins].sort(), ...(known ? { only_when: known.when } : {}) };
      if (REGISTERS_OF_EVERYWHERE.has(register)) continue;
      if (!known) result.errors.push(`register ${register} is used by ${[...entry.functions].join(", ")}: a system that is not Linux may not answer for it`);
      else for (const f of entry.functions) if (!known.functions.has(f)) result.errors.push(`register ${register} is used by ${f}, which is not the place that is known for it`);
    }
    result.cache_instructions = {};
    for (const [what, entry] of [...caches].sort()) result.cache_instructions[what] = { count: entry.count, functions: [...entry.functions].sort(), origins: [...entry.origins].sort() };
  }
  return result;
}

function archivesOf(sysroot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(a|o)$/.test(entry) && statSync(path).size > 8) found.push(path);
    }
  };
  walk(join(sysroot, "usr/lib"));
  walk(join(sysroot, "clang-resource-dir/lib"));
  return found;
}

if (import.meta.main) {
  const all = (name: string) => process.argv.flatMap((a, i) => (a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]] : []));
  const one = (name: string, fallback?: string) => all(name)[0] ?? fallback;
  const has = (name: string) => process.argv.includes(`--${name}`);
  const llvm = one("llvm", "/usr/lib/llvm-current/bin")!;
  let failed = selfTest();
  if (has("self-test") && process.argv.length === 3) process.exit(failed ? 1 : 0);
  const images = all("image");
  const archives = [...all("archive"), ...(one("sysroot") ? archivesOf(one("sysroot")!) : [])];
  const results: Result[] = [];
  for (const [i, image] of images.entries()) results.push(await check(image, llvm, true, i === 0 ? one("map", `${image}.map`) : `${image}.map`));
  for (const archive of archives) results.push(await check(archive, llvm, false, undefined));
  for (const r of results) {
    const writes = r.x18_writes.length;
    console.log(`${r.file}: ${r.instructions} instructions, x18 is read by ${r.x18_reads} and WRITTEN by ${writes}${r.data_words ? `, ${r.data_words} words of data in code` : ""}`);
    for (const w of r.data_words_that_could_run.slice(0, 30)) console.log(`    DATA   ${w.at}  ${w.instruction}   in ${w.function} (${w.origin})`);
    if (r.data_words_that_could_run.length) r.errors.push(`${r.data_words_that_could_run.length} words of data in code that could be run as instructions`);
    for (const [kind, count] of Object.entries(r.x18_reads_by_kind).sort((a, b) => b[1] - a[1])) console.log(`    read   ${String(count).padStart(6)} x  ${kind}`);
    for (const w of r.x18_writes.slice(0, 30)) console.log(`    WRITE  ${w.at}  ${w.instruction}   in ${w.function} (${w.origin})`);
    if (writes > 30) console.log(`    ... and ${writes - 30} more`);
    if (r.system_registers) for (const [register, e] of Object.entries(r.system_registers)) console.log(`    register ${register}: read ${e.reads}, written ${e.writes}, from ${e.origins.join(" ")}${e.only_when ? `, only when ${e.only_when}` : ""}`);
    if (r.cache_instructions) for (const [what, e] of Object.entries(r.cache_instructions)) console.log(`    ${what}: ${e.count}, in ${e.functions.join(" ")} (${e.origins.join(" ")})`);
    if (r.functions_with_svc !== undefined) console.log(`    ${r.tls_segment ? "TLS segment" : "no TLS segment"}, ${r.functions_with_svc} functions with svc, ${r.functions_that_read_the_thread_register} that read the thread register`);
    for (const e of r.errors) console.log(`    ERROR ${e}`);
    if (has("expect-x18-writes")) {
      if (!writes) failed++;
    } else if (writes) failed++;
    if (r.errors.length) failed++;
  }
  if (has("expect-x18-writes")) console.log(failed ? "FAILED: a negative control, and no write of x18 was found (or another rule failed)" : "negative control: writes of x18 were found, as expected");
  else console.log(failed ? "FAILED" : "passed: no instruction writes x18, and the other rules hold");
  const out = one("out");
  if (out) writeFileSync(out, JSON.stringify({ passed: !failed, expect_x18_writes: has("expect-x18-writes"), results }, null, 1) + "\n");
  process.exit(failed ? 1 : 0);
}
