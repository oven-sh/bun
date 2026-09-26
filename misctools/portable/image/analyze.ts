/**
 * Static checks of a linked x86_64 image: every instruction of the executable sections is read from
 * llvm-objdump's disassembly and attributed, through the lld link map, to the link input it came from.
 *
 *   bun image/analyze.ts <binary> <lld map> <out.json>
 *
 * Environment: OBJDUMP, READELF (default: llvm-objdump and llvm-readelf of $LLVM_BIN, or of the clang in PATH).
 *
 * Counted, each by origin:
 *   fs_gs     instructions with a %fs: or %gs: segment override (native thread-local access)
 *   syscall   syscall / sysenter / int $0x80 instructions
 *   red_zone  instructions whose memory operand is a negative displacement off %rsp with no index register,
 *             i.e. a read or write below the stack pointer. `lea` is counted apart (it computes an address
 *             and accesses nothing); an indexed operand -N(%rsp,%reg,s) is an array on the stack, counted apart.
 *   red_zone_rbp  the same access spelled through the frame pointer: in a function that sets %rbp from %rsp, an
 *             operand -N(%rbp) with N larger than everything the function allocates below %rbp (the registers
 *             it pushes after setting %rbp plus every constant it subtracts from %rsp). A function that also
 *             moves %rsp by a register or realigns it only ever has MORE stack than that, so it is judged the
 *             same way when its deepest access is within the constant part, and listed as "not judged"
 *             otherwise (its frame has to be read).
 * An origin is "musl" (a member of the sysroot's libc.a), an archive, an object, or a Rust crate.
 *
 * A linear sweep decodes data inside .text as instructions (JavaScriptCore's LLInt puts opcode ids after
 * indirect jumps). Every site outside musl is therefore written out with its bytes, symbol and neighbours,
 * so that it can be judged by reading it.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { llvmBin } from "../flags.ts";

const [binary, mapPath, outPath] = process.argv.slice(2);
if (binary === undefined || mapPath === undefined || outPath === undefined) {
  console.error("usage: bun image/analyze.ts <binary> <lld map> <out.json>");
  process.exit(2);
}
const objdump = process.env.OBJDUMP ?? join(llvmBin(), "llvm-objdump");
const readelf = process.env.READELF ?? join(llvmBin(), "llvm-readelf");

// ─── link map: input sections by address ───
interface Range {
  start: number;
  end: number;
  input: string;
  section: string;
}
/** The output sections with code in them (flag X), from the section headers. */
function executableSections(file: string): Set<string> {
  const r = Bun.spawnSync([readelf, "-SW", file], { stdout: "pipe", stderr: "inherit" });
  const names = new Set<string>();
  for (const line of r.stdout.toString().split("\n")) {
    const m = /^\s*\[\s*\d+\]\s+(\S+)\s+\S+\s+[0-9a-f]+\s+[0-9a-f]+\s+[0-9a-f]+\s+[0-9a-f]+\s+([A-Za-z]*)\s/.exec(line);
    if (m !== null && m[2]!.includes("X")) names.add(m[1]!);
  }
  return names;
}

function readMap(path: string, executable: Set<string>): Range[] {
  const ranges: Range[] = [];
  const text = readFileSync(path, "utf8");
  // An output section row has the section's name where an input row has 8 spaces.
  const outputRow = /^\s*[0-9a-f]+\s+[0-9a-f]+\s+[0-9a-f]+\s+\d+ (\S+)$/;
  let output = "";
  // "     VMA      LMA     Size Align Out     In      Symbol"; an input section row is indented by 8 after the
  // four numbers and reads `<file>:(<section>)`, a symbol row by 16.
  const row = /^\s*([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+(\d+) {9}(\S.*):\((.*)\)$/;
  for (const line of text.split("\n")) {
    const o = outputRow.exec(line);
    if (o !== null) {
      output = o[1]!;
      continue;
    }
    if (!executable.has(output)) continue;
    const m = row.exec(line);
    if (m === null) continue;
    const start = parseInt(m[1]!, 16);
    const size = parseInt(m[3]!, 16);
    if (size === 0) continue;
    ranges.push({ start, end: start + size, input: m[5]!, section: m[6]! });
  }
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

function find(ranges: Range[], address: number): Range | undefined {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (address < r.start) hi = mid - 1;
    else if (address >= r.end) lo = mid + 1;
    else return r;
  }
  return undefined;
}

/** The origin of a link input, for the totals: a library, a crate, or one of bun's own groups of objects. */
export function originOf(input: string): string {
  // archive member: /path/libfoo.a(member.o)
  const archive = /^(.*\/)?([^/]+\.(?:a|rlib))\((.*)\)$/.exec(input);
  if (archive !== null) {
    const name = archive[2]!;
    if (name === "libc.a") return "musl (libc.a)";
    const rlib = /^lib(.+?)-[0-9a-f]{16}\.rlib$/.exec(name);
    if (rlib !== null) return `rust crate ${rlib[1]}`;
    return name;
  }
  // ThinLTO output: lld names the object after the module it was generated from.
  const lto = /\.lto\.(.*)$/.exec(basename(input));
  const fromModule = lto !== null ? lto[1]! : input;
  const crate =
    /lib(.+?)-[0-9a-f]{16}\.rlib/.exec(fromModule) ?? /(?:^|[/.])([a-z0-9_]+)-[0-9a-f]{16}\..*rcgu/.exec(fromModule);
  if (crate !== null) return `rust crate ${crate[1]} (LTO)`;
  if (input === "<internal>") return "<linker>";
  const vendor = /(?:^|\/)obj\/vendor\/([^/]+)\//.exec(input);
  if (vendor !== null) return `vendor/${vendor[1]}`;
  const memfn = /\/portable-memfn\/([^/]+)$/.exec(input);
  if (memfn !== null) return `sysroot portable-memfn/${memfn[1]}`;
  const own = /(?:^|\/)obj\/(src|packages|codegen|unified)\//.exec(input);
  if (own !== null) return `bun C/C++ (obj/${own[1]})`;
  if (/\/(rcrt1|crt1|Scrt1|crti|crtn)\.o$/.test(input)) return "musl (crt)";
  if (/clang_rt\.crt(begin|end)\.o$/.test(input)) return "compiler-rt (crtbegin/crtend)";
  return input;
}

interface Site {
  address: string;
  symbol: string;
  instruction: string;
  bytes: string;
  input: string;
  section: string;
  before: string[];
  after: string[];
}
type Kind = "fs_gs" | "syscall" | "red_zone" | "red_zone_rbp" | "lea_below_rsp" | "indexed_below_rsp";
const kinds: Kind[] = ["fs_gs", "syscall", "red_zone", "red_zone_rbp", "lea_below_rsp", "indexed_below_rsp"];

const executable = executableSections(binary);
const ranges = readMap(mapPath, executable);
console.error(`map: ${ranges.length} input sections in ${[...executable].join(" ")}`);
for (let i = 1; i < ranges.length; i++) {
  if (ranges[i]!.start < ranges[i - 1]!.end) {
    console.error(`map: input sections overlap at 0x${ranges[i]!.start.toString(16)}`);
    process.exit(1);
  }
}

const newMaps = () =>
  Object.fromEntries(kinds.map(k => [k, new Map<string, number>()])) as Record<Kind, Map<string, number>>;
const counts = newMaps();
const forms = newMaps();
const sites = Object.fromEntries(kinds.map(k => [k, [] as Site[]])) as Record<Kind, Site[]>;
const pendingAfter: { site: Site; left: number }[] = [];
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

// -N(%rsp) with no index: "-0x8(%rsp)". With an index: "-0x8(%rsp,%rax,8)".
const belowRsp = /(?:^|[\s,])-0x[0-9a-f]+\(%rsp\)/;
const belowRspIndexed = /(?:^|[\s,])-0x[0-9a-f]+\(%rsp,/;
const segment = /%[fg]s:/;

let instructions = 0;
let unattributed = 0;
let symbol = "";

// ─── per function: what it allocates below %rbp, and the deepest constant offset it accesses there ───
const belowRbp = /(?:^|[\s,])-0x([0-9a-f]+)\(%rbp\)/;
interface Frame {
  probing: boolean;
  probeLoop: boolean;
  setsRbp: boolean;
  inPrologue: boolean;
  allocated: number;
  notJudged: boolean;
  deepest: number;
  deepestSite: { address: string; text: string; bytes: string } | undefined;
  functions: number;
}
let frame: Frame = {
  probing: false,
  probeLoop: false,
  setsRbp: false,
  inPrologue: false,
  allocated: 0,
  notJudged: false,
  deepest: 0,
  deepestSite: undefined,
  functions: 0,
};
let functionsWithFramePointer = 0;
let functionsNotJudged = 0;
let functionsWithVariableFrameWithinConstantPart = 0;
// Not judged, by the link input they are in, and by name where that input is assembly (no compiler flag applies).
const notJudgedByInput = new Map<string, number>();
const notJudgedInAssembly: { symbol: string; input: string; deepest_below_rbp: string; constant_allocation: string }[] =
  [];
const notJudgedCompiled: { symbol: string; input: string; deepest_below_rbp: string; constant_allocation: string }[] =
  [];
let functionStart = "";
function endFunction() {
  if (frame.setsRbp) {
    functionsWithFramePointer++;
    if (frame.notJudged && frame.deepest <= frame.allocated) {
      functionsWithVariableFrameWithinConstantPart++;
    } else if (frame.notJudged) {
      functionsNotJudged++;
      const input = find(ranges, parseInt(functionStart, 16))?.input ?? "<not in the map>";
      bump(notJudgedByInput, originOf(input));
      if (!(/\.(S|s|asm)\.o$/.test(input) || /LowLevelInterpreter/.test(input))) {
        if (notJudgedCompiled.length < 200) {
          notJudgedCompiled.push({
            symbol,
            input,
            deepest_below_rbp: "0x" + frame.deepest.toString(16),
            constant_allocation: "0x" + frame.allocated.toString(16),
          });
        }
      } else {
        notJudgedInAssembly.push({
          symbol,
          input,
          deepest_below_rbp: "0x" + frame.deepest.toString(16),
          constant_allocation: "0x" + frame.allocated.toString(16),
        });
      }
    } else if (frame.deepest > frame.allocated && frame.deepestSite !== undefined) {
      const address = parseInt(frame.deepestSite.address, 16);
      const range = find(ranges, address);
      const input = range?.input ?? "<not in the map>";
      const origin = originOf(input);
      bump(counts.red_zone_rbp, origin);
      bump(forms.red_zone_rbp, "function accessing -N(%rbp) below what it allocated");
      if (!origin.startsWith("musl") && sites.red_zone_rbp.length < MAX_SITES_KEPT) {
        sites.red_zone_rbp.push({
          address: frame.deepestSite.address,
          symbol,
          instruction: `${frame.deepestSite.text}   [allocated below %rbp: 0x${frame.allocated.toString(16)}]`,
          bytes: frame.deepestSite.bytes,
          input,
          section: range?.section ?? "",
          before: [],
          after: [],
        });
      }
    }
  }
  frame = {
    probing: false,
    probeLoop: false,
    setsRbp: false,
    inPrologue: false,
    allocated: 0,
    notJudged: false,
    deepest: 0,
    deepestSite: undefined,
    functions: 0,
  };
}
function trackFrame(address: string, mnemonic: string, operands: string, text: string, bytes: string) {
  if (!frame.setsRbp) {
    if (mnemonic === "movq" && operands === "%rsp, %rbp") {
      frame.setsRbp = true;
      frame.inPrologue = true;
      functionStart = address;
    }
    return;
  }
  if (mnemonic === "movq" && operands === "%rsp, %rbp") {
    // a second entry point or a tail-merged body: what follows is another frame
    frame.notJudged = true;
    return;
  }
  if (frame.inPrologue) {
    if (mnemonic === "pushq" || mnemonic === "pushfq") {
      frame.allocated += 8;
      return;
    }
    if (mnemonic.startsWith("call") || mnemonic.startsWith("j") || mnemonic.startsWith("ret")) frame.inPrologue = false;
  }
  // Stack probing of a frame larger than a page: the compiler puts the final stack pointer in %r11
  // (movq %rsp,%r11; subq $SIZE,%r11) and walks down to it a page at a time
  // (subq $0x1000,%rsp; movq $0,(%rsp); cmpq %r11,%rsp; jne). SIZE is what that loop allocates.
  if (mnemonic === "movq" && operands === "%rsp, %r11") {
    frame.probing = true;
    return;
  }
  if (frame.probing && mnemonic === "subq") {
    const size = /^\$0x([0-9a-f]+), %r11$/.exec(operands);
    if (size !== null) {
      frame.allocated += parseInt(size[1]!, 16);
      frame.probeLoop = true;
      frame.probing = false;
      return;
    }
  }
  if (operands.endsWith(", %rsp")) {
    // comparisons read the stack pointer
    if (mnemonic.startsWith("cmp") || mnemonic.startsWith("test")) return;
    const sub = /^\$0x([0-9a-f]+), %rsp$/.exec(operands);
    if (mnemonic === "subq" && sub !== null && frame.probeLoop && sub[1] === "1000") {
      // the body of the probing loop: counted with SIZE
      frame.probeLoop = false;
      frame.inPrologue = false;
    } else if (mnemonic === "subq" && sub !== null) {
      frame.allocated += parseInt(sub[1]!, 16);
      frame.inPrologue = false;
    } else if (mnemonic === "addq" && /^\$-0x[0-9a-f]+, %rsp$/.test(operands)) {
      frame.allocated += parseInt(operands.slice(4), 16);
    } else if (mnemonic === "addq" || mnemonic === "popq" || (mnemonic === "movq" && operands === "%rbp, %rsp")) {
      // releasing stack: nothing to add
    } else {
      // subq %reg / andq (realignment) / leaq / movq from elsewhere: the frame is not a constant
      frame.notJudged = true;
    }
    return;
  }
  if (mnemonic.startsWith("lea")) return;
  const m = belowRbp.exec(operands);
  if (m === null) return;
  const depth = parseInt(m[1]!, 16);
  if (depth > frame.deepest) {
    frame.deepest = depth;
    frame.deepestSite = { address, text, bytes };
  }
}
const recent: string[] = [];
const MAX_SITES_KEPT = 400;

const child = spawn(objdump, ["-d", "--print-imm-hex", binary], {
  stdio: ["ignore", "pipe", "inherit"],
});
const exited: Promise<number> = new Promise(resolve => child.on("close", resolve));
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
// "  201000: 48 89 e5                     	movq	%rsp, %rbp"
const insn = /^\s*([0-9a-f]+):\s+((?:[0-9a-f]{2} )+)\s*\t(.*)$/;
const label = /^[0-9a-f]+ <(.*)>:$/;

for await (const line of lines) {
  const l = label.exec(line);
  if (l !== null) {
    endFunction();
    symbol = l[1]!;
    continue;
  }
  const m = insn.exec(line);
  if (m === null) continue;
  instructions++;
  const text = m[3]!.replace(/\s+/g, " ").trim();
  for (let i = pendingAfter.length - 1; i >= 0; i--) {
    const p = pendingAfter[i]!;
    p.site.after.push(`${m[1]}: ${text}`);
    if (--p.left === 0) pendingAfter.splice(i, 1);
  }
  const space = text.indexOf(" ");
  const mnemonic = space < 0 ? text : text.slice(0, space);
  const operands = space < 0 ? "" : text.slice(space + 1).replace(/\s*#.*$/, "");
  trackFrame(m[1]!, mnemonic, operands, text, m[2]!.trim());
  let kind: Kind | undefined;
  if (segment.test(operands)) kind = "fs_gs";
  else if (mnemonic === "syscall" || mnemonic === "sysenter" || (mnemonic === "int" && operands === "$0x80")) {
    kind = "syscall";
  } else if (belowRspIndexed.test(operands)) kind = "indexed_below_rsp";
  else if (belowRsp.test(operands)) kind = mnemonic.startsWith("lea") ? "lea_below_rsp" : "red_zone";
  if (kind !== undefined) {
    const address = parseInt(m[1]!, 16);
    const range = find(ranges, address);
    if (range === undefined) unattributed++;
    const input = range?.input ?? "<not in the map>";
    const origin = originOf(input);
    bump(counts[kind], origin);
    bump(
      forms[kind],
      `${mnemonic} ${operands.replace(/0x[0-9a-f]+/g, "N").replace(/%(?!rsp|fs|gs)[a-z0-9]+/g, "%REG")}`,
    );
    const isMusl = origin.startsWith("musl");
    if (!isMusl && sites[kind].length < MAX_SITES_KEPT) {
      const site: Site = {
        address: m[1]!,
        symbol,
        instruction: text,
        bytes: m[2]!.trim(),
        input,
        section: range?.section ?? "",
        before: recent.slice(-3),
        after: [],
      };
      sites[kind].push(site);
      pendingAfter.push({ site, left: 2 });
    }
  }
  recent.push(`${m[1]}: ${text}`);
  if (recent.length > 3) recent.shift();
}
endFunction();
const code = await exited;
if (code !== 0) {
  console.error(`llvm-objdump exited with ${code}`);
  process.exit(1);
}

const table = (map: Map<string, number>) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).map(([origin, count]) => ({ origin, count }));
const total = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0);
const outsideMusl = (map: Map<string, number>) =>
  [...map.entries()].filter(([origin]) => !origin.startsWith("musl")).reduce((a, [, n]) => a + n, 0);

const { stdout: headers } = Bun.spawnSync([readelf, "-lW", "-d", binary]);
const programHeaders = headers.toString();
const result = {
  binary,
  map: mapPath,
  instructions,
  sites_not_in_the_map: unattributed,
  frame_pointer_check: {
    functions_that_set_rbp_from_rsp: functionsWithFramePointer,
    of_those_with_a_variable_frame_whose_accesses_stay_in_its_constant_part:
      functionsWithVariableFrameWithinConstantPart,
    not_judged_because_the_frame_is_not_constant: functionsNotJudged,
    not_judged_by_origin: table(notJudgedByInput),
    not_judged_in_assembly: notJudgedInAssembly,
    not_judged_in_compiled_code: notJudgedCompiled,
  },
  elf: {
    type: /Elf file type is (\S+)/.exec(programHeaders)?.[1],
    PT_INTERP: /^\s*INTERP\s/m.test(programHeaders),
    PT_TLS: /^\s*TLS\s/m.test(programHeaders),
    PT_DYNAMIC: /^\s*DYNAMIC\s/m.test(programHeaders),
    DT_NEEDED: [...programHeaders.matchAll(/\(NEEDED\)\s+(.*)$/gm)].map(m => m[1]),
    load_segment_alignments: [...programHeaders.matchAll(/^\s*LOAD\s.*\s(0x[0-9a-f]+)\s*$/gm)].map(m => m[1]),
  },
  // bytes of the executable sections by origin: what the counts below are counts OF
  code_bytes_by_origin: (() => {
    const bytes = new Map<string, number>();
    for (const r of ranges) bytes.set(originOf(r.input), (bytes.get(originOf(r.input)) ?? 0) + (r.end - r.start));
    return [...bytes.entries()].sort((a, b) => b[1] - a[1]).map(([origin, n]) => ({ origin, bytes: n }));
  })(),
  totals: Object.fromEntries(
    kinds.map(kind => [kind, { all: total(counts[kind]), outside_musl: outsideMusl(counts[kind]) }]),
  ),
  by_origin: Object.fromEntries(kinds.map(kind => [kind, table(counts[kind])])),
  forms: Object.fromEntries(kinds.map(kind => [kind, table(forms[kind]).slice(0, 40)])),
  sites_outside_musl: sites,
};
writeFileSync(outPath, JSON.stringify(result, null, 1) + "\n");
console.log(
  JSON.stringify({ instructions, elf: result.elf, totals: result.totals, by_origin: result.by_origin }, null, 1),
);
