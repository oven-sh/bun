/**
 * Which code of a linked x86_64 image only a Windows host runs, proven from the image.
 *
 * The image holds bun's code for every host and picks when it runs: it reads the byte that says whose
 * functions the code calls (`bun_alloc::host::imp::NATIVE`, 2 is Windows) and branches. bun's code for
 * Windows reads the TEB through gs, as every program for Windows does. image/analyze.ts counts such an
 * instruction as an error outside of the libc, unless this file proves that only a Windows host reaches it.
 *
 * Three proofs, in this order:
 *   an arm of a dispatch   In the function of the instruction, every way from the entry to the instruction
 *                          passes a branch that is taken when the byte is 2. Or no way from a root of the
 *                          image to the function is without such a branch: every call of the function, and
 *                          every place that takes its address, is in code that only a Windows host runs.
 *   a flavour for Windows  The function is a definition for Windows of something that has one for each
 *                          host: its name, or the name of its crate, ends with `__windows`.
 *   bindings of Windows    The function is of bun's bindings of Windows and libuv: the crates
 *                          bun_windows_sys and bun_libuv_sys, and the modules of bun_core, bun_errno and
 *                          bun_sys whose name says so (`windows`, `windows_impl`, `windows_stdio`, `sys_uv`).
 * The first is a proof about the machine code. The other two read the name of the function, which is in the
 * image, and say so in their reason.
 *
 * How the first proof reads a function: its instructions become blocks, a block ends where control may go
 * somewhere else. A register holds the byte after a load from NATIVE, or after a call of the function that
 * reads it; the flags say "equal means Windows" after a compare of such a register with 2. A conditional
 * jump on those flags has one way for Windows. The blocks that the entry reaches WITHOUT such a way are
 * the ones another host runs. A jump through a table goes to every entry of the table, which is read from
 * the image; a function with a jump that cannot be read that way is not judged. A call of a function that
 * does not return ends a block: a function does not return when it has no instruction that returns and
 * every jump that leaves it goes to a function that does not return (what the compiler puts behind a
 * failed allocation or a panic).
 *
 * The roots of the image, for the second half of the first proof: the entry point, every function whose
 * address is in data (a relocation), and every function that nothing refers to.
 */

export interface Instruction {
  address: number;
  /** Bytes of the instruction. */
  length: number;
  mnemonic: string;
  /** Without the comment of the disassembler. */
  operands: string;
  /** The address in the comment of the disassembler, `# 0x..`, which is what a `(%rip)` operand names. */
  named: number | undefined;
}

/** Registers by the name of their 64 bits. */
const WIDE: Record<string, string> = {};
for (const [wide, ...narrow] of [
  ["rax", "eax", "ax", "al", "ah"],
  ["rbx", "ebx", "bx", "bl", "bh"],
  ["rcx", "ecx", "cx", "cl", "ch"],
  ["rdx", "edx", "dx", "dl", "dh"],
  ["rsi", "esi", "si", "sil"],
  ["rdi", "edi", "di", "dil"],
  ["rbp", "ebp", "bp", "bpl"],
  ["rsp", "esp", "sp", "spl"],
]) {
  for (const name of [wide, ...narrow]) WIDE[name!] = wide!;
}
for (let n = 8; n < 16; n++) for (const suffix of ["", "d", "w", "b"]) WIDE[`r${n}${suffix}`] = `r${n}`;

const registerOf = (operand: string): string | undefined => {
  const m = /^%([a-z0-9]+)$/.exec(operand.trim());
  return m === null ? undefined : WIDE[m[1]!];
};

/** What a call may change. */
const CHANGED_BY_A_CALL = ["rax", "rcx", "rdx", "rsi", "rdi", "r8", "r9", "r10", "r11"];

/** Instructions that leave the flags as they are. */
const keepsFlags = (mnemonic: string) =>
  /^(mov|lea|push|pop|nop|set|cmov|j|vmov|call|ret|xchg|not|bswap|prefetch|endbr)/.test(mnemonic) ||
  mnemonic === "cltq" ||
  mnemonic === "cqto";

function operandsOf(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of text) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += c;
  }
  if (current.trim() !== "") out.push(current.trim());
  return out;
}

type Holds = "byte" | "windows" | "not-windows";
type Flags = "equal-is-windows" | "not-equal-is-windows" | undefined;
interface State {
  registers: Map<string, Holds>;
  flags: Flags;
}

const sameState = (a: State, b: State) =>
  a.flags === b.flags &&
  a.registers.size === b.registers.size &&
  [...a.registers].every(([name, holds]) => b.registers.get(name) === holds);

/** What both ways into a block agree on. */
function meet(a: State, b: State): State {
  const registers = new Map<string, Holds>();
  for (const [name, holds] of a.registers) if (b.registers.get(name) === holds) registers.set(name, holds);
  return { registers, flags: a.flags === b.flags ? a.flags : undefined };
}

interface Block {
  first: number;
  /** One after the last instruction. */
  end: number;
  /** Blocks that follow, and whether the way there is one for Windows. */
  next: { to: number; windows: boolean }[];
}

export interface Judged {
  /** False: the function has a jump that could not be read. Nothing in it is proven. */
  readable: boolean;
  /** Branches of the function that have one way for Windows. */
  branches: number;
  /** For each instruction: only a way for Windows reaches it. */
  windowsOnly: boolean[];
}

export class Reader {
  constructor(
    /** The address of `NATIVE`. */
    readonly native: number,
    /** The address of the function that reads the byte when nothing has yet, and returns it. */
    readonly readsNative: number,
    /** The bytes of the image at an address of its memory, for the tables of jumps. */
    readonly bytesAt: (address: number, length: number) => Buffer | undefined,
    /** Whether the function at an address never returns to who called it. */
    readonly neverReturns: (address: number) => boolean = () => false,
  ) {}

  /** Cheap: does the function ask for the byte at all. */
  asks(instructions: Instruction[]): boolean {
    for (const i of instructions) if (i.named === this.native || i.named === this.readsNative) return true;
    return false;
  }

  judge(start: number, end: number, instructions: Instruction[]): Judged {
    const n = instructions.length;
    const indexOf = new Map<number, number>();
    instructions.forEach((i, at) => indexOf.set(i.address, at));
    const inside = (address: number) => address >= start && address < end && indexOf.has(address);

    // ---- where control goes ----
    type Way =
      | { kind: "on" }
      | { kind: "jump"; to: number }
      | { kind: "branch"; to: number }
      | { kind: "table"; to: number[] }
      | { kind: "away" }
      | { kind: "unreadable" };
    const ways: Way[] = [];
    for (let at = 0; at < n; at++) {
      const i = instructions[at]!;
      const m = i.mnemonic;
      const target = /^0x([0-9a-f]+)\b/.exec(i.operands);
      if (m === "jmp" || m === "jmpq") {
        if (i.operands.startsWith("*")) {
          const table = this.table(instructions, at, start, end, inside);
          ways.push(table === undefined ? { kind: "away" } : table === null ? { kind: "unreadable" } : { kind: "table", to: table });
        } else if (target !== null) {
          const to = parseInt(target[1]!, 16);
          ways.push(inside(to) ? { kind: "jump", to } : { kind: "away" });
        } else ways.push({ kind: "unreadable" });
      } else if (/^j[a-z]+$/.test(m) || /^(loop|jrcxz|jecxz)/.test(m)) {
        if (target === null) ways.push({ kind: "unreadable" });
        else {
          const to = parseInt(target[1]!, 16);
          // A conditional jump out of the function is a call in the place of a return.
          ways.push(inside(to) ? { kind: "branch", to } : { kind: "on" });
        }
      } else if (/^(ret|retq|ud2|hlt|int3|iretq)$/.test(m)) ways.push({ kind: "away" });
      else if (m.startsWith("call") && target !== null && this.neverReturns(parseInt(target[1]!, 16))) ways.push({ kind: "away" });
      else ways.push({ kind: "on" });
    }
    if (ways.some(way => way.kind === "unreadable")) return { readable: false, branches: 0, windowsOnly: [] };

    const leaders = new Set<number>([0]);
    for (let at = 0; at < n; at++) {
      const way = ways[at]!;
      if (way.kind === "on") continue;
      if (at + 1 < n) leaders.add(at + 1);
      if (way.kind === "jump" || way.kind === "branch") leaders.add(indexOf.get(way.to)!);
      if (way.kind === "table") for (const to of way.to) leaders.add(indexOf.get(to)!);
    }
    const firsts = [...leaders].sort((a, b) => a - b);
    const blocks: Block[] = firsts.map((first, k) => ({ first, end: firsts[k + 1] ?? n, next: [] }));
    const blockAt = new Map<number, number>();
    blocks.forEach((block, k) => blockAt.set(block.first, k));
    const blockOfAddress = (address: number) => blockAt.get(indexOf.get(address)!)!;

    // ---- what the registers and the flags hold, block by block, until nothing changes ----
    const entry: (State | undefined)[] = blocks.map(() => undefined);
    entry[0] = { registers: new Map(), flags: undefined };
    const work = [0];
    let branches = 0;
    const verdicts = new Map<number, { taken: boolean; fallsThrough: boolean }>();
    let rounds = 0;
    while (work.length > 0) {
      if (++rounds > blocks.length * 64 + 1024) return { readable: false, branches: 0, windowsOnly: [] };
      const k = work.pop()!;
      const block = blocks[k]!;
      const state: State = { registers: new Map(entry[k]!.registers), flags: entry[k]!.flags };
      for (let at = block.first; at < block.end; at++) this.step(instructions[at]!, state);
      const last = block.end - 1;
      const way = ways[last]!;
      const next: { to: number; windows: boolean }[] = [];
      if (way.kind === "on") {
        if (block.end < n) next.push({ to: k + 1, windows: false });
      } else if (way.kind === "jump") next.push({ to: blockOfAddress(way.to), windows: false });
      else if (way.kind === "table") for (const to of way.to) next.push({ to: blockOfAddress(to), windows: false });
      else if (way.kind === "branch") {
        const m = instructions[last]!.mnemonic;
        // What the flags said before the jump: the jump itself changes nothing.
        const flags = state.flags;
        const equal = m === "je" || m === "jz";
        const notEqual = m === "jne" || m === "jnz";
        let taken = false;
        let fallsThrough = false;
        if (flags !== undefined && (equal || notEqual)) {
          const windowsWhenEqual = flags === "equal-is-windows";
          taken = equal === windowsWhenEqual;
          fallsThrough = !taken;
        }
        verdicts.set(last, { taken, fallsThrough });
        next.push({ to: blockOfAddress(way.to), windows: taken });
        if (block.end < n) next.push({ to: k + 1, windows: fallsThrough });
      }
      block.next = next;
      for (const edge of next) {
        const before = entry[edge.to];
        const after = before === undefined ? state : meet(before, state);
        if (before === undefined || !sameState(before, after)) {
          entry[edge.to] = { registers: new Map(after.registers), flags: after.flags };
          if (!work.includes(edge.to)) work.push(edge.to);
        }
      }
    }
    for (const verdict of verdicts.values()) if (verdict.taken || verdict.fallsThrough) branches++;

    // ---- what the entry reaches without a way for Windows ----
    const reached = blocks.map(() => false);
    const stack = [0];
    reached[0] = true;
    while (stack.length > 0) {
      const k = stack.pop()!;
      for (const edge of blocks[k]!.next) {
        if (edge.windows || reached[edge.to]) continue;
        reached[edge.to] = true;
        stack.push(edge.to);
      }
    }
    // A block that nothing reaches at all is not code that a way for Windows reaches: it stays unproven.
    const reachedAtAll = blocks.map(() => false);
    reachedAtAll[0] = true;
    const all = [0];
    while (all.length > 0) {
      const k = all.pop()!;
      for (const edge of blocks[k]!.next) {
        if (reachedAtAll[edge.to]) continue;
        reachedAtAll[edge.to] = true;
        all.push(edge.to);
      }
    }
    const windowsOnly: boolean[] = new Array(n).fill(false);
    blocks.forEach((block, k) => {
      if (reached[k] || !reachedAtAll[k]) return;
      for (let at = block.first; at < block.end; at++) windowsOnly[at] = true;
    });
    return { readable: true, branches, windowsOnly };
  }

  /** One instruction: what the registers and the flags hold after it. */
  private step(i: Instruction, state: State): void {
    const m = i.mnemonic;
    const operands = operandsOf(i.operands);
    const last = operands[operands.length - 1];
    const written = last === undefined ? undefined : registerOf(last);

    if (m.startsWith("call")) {
      for (const name of CHANGED_BY_A_CALL) state.registers.delete(name);
      state.flags = undefined;
      if (i.named === undefined && /^0x[0-9a-f]+/.test(i.operands)) {
        if (parseInt(i.operands.slice(2), 16) === this.readsNative) state.registers.set("rax", "byte");
      }
      return;
    }
    if (m.startsWith("cmp") && operands.length === 2) {
      const holds = registerOf(operands[1]!) === undefined ? undefined : state.registers.get(registerOf(operands[1]!)!);
      const ofMemory = i.named === this.native && /\(%rip\)$/.test(operands[1]!);
      state.flags = /^\$0x2$/.test(operands[0]!) && (holds === "byte" || ofMemory) ? "equal-is-windows" : undefined;
      return;
    }
    if (m.startsWith("test") && operands.length === 2 && operands[0] === operands[1]) {
      const name = registerOf(operands[0]!);
      const holds = name === undefined ? undefined : state.registers.get(name);
      state.flags = holds === "windows" ? "not-equal-is-windows" : holds === "not-windows" ? "equal-is-windows" : undefined;
      return;
    }
    if (/^set(e|z|ne|nz)$/.test(m) && written !== undefined) {
      const equal = m === "sete" || m === "setz";
      if (state.flags === undefined) state.registers.delete(written);
      else state.registers.set(written, equal === (state.flags === "equal-is-windows") ? "windows" : "not-windows");
      return;
    }
    if (/^mov(zb[lwq]|b)$/.test(m) && operands.length === 2 && written !== undefined) {
      if (i.named === this.native && /\(%rip\)$/.test(operands[0]!)) {
        state.registers.set(written, "byte");
        return;
      }
      const from = registerOf(operands[0]!);
      const holds = from === undefined ? undefined : state.registers.get(from);
      if (holds === undefined) state.registers.delete(written);
      else state.registers.set(written, holds);
      return;
    }
    if (/^mov[lq]?$/.test(m) && operands.length === 2 && written !== undefined) {
      const from = registerOf(operands[0]!);
      const holds = from === undefined ? undefined : state.registers.get(from);
      if (holds === undefined) state.registers.delete(written);
      else state.registers.set(written, holds);
      return;
    }
    if (!keepsFlags(m)) state.flags = undefined;
    if (/^(push|cmp|test|j|nop|prefetch)/.test(m)) return;
    // Everything else: what it names last is written, and what an instruction writes without naming it.
    if (written !== undefined) state.registers.delete(written);
    if (/^(mul|imul|div|idiv|cpuid|rdtsc|xgetbv|cmpxchg|syscall|rep|cltq|cqto|cwtl|cltd|xchg|pop)/.test(m)) {
      for (const name of ["rax", "rdx", "rcx", "rbx", "rsi", "rdi"]) state.registers.delete(name);
      for (const operand of operands) {
        const name = registerOf(operand);
        if (name !== undefined) state.registers.delete(name);
      }
    }
  }

  /**
   * The targets of `jmpq *%reg` when the register was made of a table: `leaq TABLE(%rip), %base`,
   * `movslq (%base,%index,4), %reg`, `addq %base, %reg`. undefined: the jump is not of that kind, it
   * leaves the function (a call through a pointer in the place of a return). null: it is of that kind
   * and the table was not found.
   */
  private table(
    instructions: Instruction[],
    at: number,
    start: number,
    end: number,
    inside: (address: number) => boolean,
  ): number[] | undefined | null {
    const register = registerOf(instructions[at]!.operands.slice(1));
    if (register === undefined) {
      // Through memory: `jmpq *TABLE(,%reg,8)` is a table of addresses, which an image that can be
      // mapped anywhere does not have in its code. `jmpq *0x18(%rax)` is a call through a pointer.
      return /\(,%/.test(instructions[at]!.operands) ? null : undefined;
    }
    let base: string | undefined;
    let load = -1;
    for (let back = at - 1; back >= 0 && back >= at - 12; back--) {
      const i = instructions[back]!;
      const operands = operandsOf(i.operands);
      if (i.mnemonic === "movslq" && operands.length === 2 && registerOf(operands[1]!) !== undefined) {
        const m = /^\(%([a-z0-9]+),%[a-z0-9]+,4\)$/.exec(operands[0]!);
        if (m !== null) {
          base = WIDE[m[1]!];
          load = back;
          break;
        }
      }
      if (/^(j|call|ret)/.test(i.mnemonic)) break;
    }
    if (base === undefined) return undefined;
    // The table: the last `leaq X(%rip), %base` in front of the load, in this function.
    for (let back = load - 1; back >= 0; back--) {
      const i = instructions[back]!;
      const operands = operandsOf(i.operands);
      if (i.mnemonic !== "leaq" || operands.length !== 2 || registerOf(operands[1]!) !== base) continue;
      if (i.named === undefined || !/\(%rip\)$/.test(operands[0]!)) return null;
      const targets = new Set<number>();
      for (let entry = 0; entry < 4096; entry++) {
        const bytes = this.bytesAt(i.named + entry * 4, 4);
        if (bytes === undefined) break;
        const to = i.named + bytes.readInt32LE(0);
        if (!inside(to)) break;
        targets.add(to);
      }
      return targets.size === 0 ? null : [...targets];
    }
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The names
// ───────────────────────────────────────────────────────────────────────────

/** The reason that the name of a function gives, if it gives one. `name` is the demangled name. */
export function byName(name: string, input: string): { kind: "flavour" | "bindings"; reason: string } | undefined {
  // `<T as Trait>::method`: the implementation is where the trait is implemented, which the path of the
  // trait and of the type say. Both are looked at.
  const paths = [...name.matchAll(/[A-Za-z_][A-Za-z_0-9]*(?:::[A-Za-z_][A-Za-z_0-9]*)+/g)].map(m => m[0]);
  if (paths.length === 0) paths.push(name);
  const crateOfInput = /lib([A-Za-z0-9_]+?)-[0-9a-f]{16}\.rlib/.exec(input)?.[1];
  if (crateOfInput !== undefined && crateOfInput.endsWith("__windows")) {
    return { kind: "flavour", reason: `a flavour for Windows: the crate ${crateOfInput}` };
  }
  for (const path of paths) {
    const segments = path.split("::");
    if (segments[0]!.endsWith("__windows")) {
      return { kind: "flavour", reason: `a flavour for Windows: the crate ${segments[0]}` };
    }
    const named = segments.find(segment => segment.endsWith("__windows"));
    if (named !== undefined) {
      return {
        kind: "flavour",
        reason: `the definition for Windows of what has one for each host: ${named} in ${segments.slice(0, 2).join("::")}`,
      };
    }
  }
  if (/__windows$/.test(name)) return { kind: "flavour", reason: `a flavour for Windows: the symbol ${name}` };
  for (const path of paths) {
    const segments = path.split("::");
    if (segments[0] === "bun_windows_sys" || segments[0] === "bun_libuv_sys") {
      return { kind: "bindings", reason: `bindings of Windows: the crate ${segments[0]}` };
    }
    if (!["bun_core", "bun_errno", "bun_sys"].includes(segments[0]!)) continue;
    const module = segments
      .slice(1, -1)
      .find(segment => /^(windows|windows_impl|windows_stdio|windows_sys|windows_errno|sys_uv|sys_uv_windows)$/.test(segment));
    if (module !== undefined) {
      return { kind: "bindings", reason: `bindings of Windows: the module ${segments[0]}::${module}` };
    }
  }
  return undefined;
}
