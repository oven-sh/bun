/**
 * Test tool, aarch64: copy an ELF file and replace chosen instructions in its code.
 *
 * A hosted run on a Linux test host cannot show by itself that the image stays
 * away from Linux: a stray "svc 0" just works there. So the tests run copies of
 * the image in which the instructions that must not run are traps (udf, SIGILL).
 *
 *   bun test/rewrite_insn.ts <in> <out> <rule>...
 *
 *   no-svc          svc 0               -> udf #1   must not run on a host that is not Linux
 *   no-tpidr        mrs/msr tpidr_el0   -> udf #2   same
 *   no-tpidrro      mrs xN, tpidrro_el0 -> udf #3   must run on a macOS host only
 *   no-x18          mov xN, x18         -> udf #4   must run on a Windows host only
 *   no-x18-reload   ldr x18, [sp, #16]  -> nop      breaks the shims of the arm64 linux test
 *                                                   host (host/host_posix.c), a run must fail
 *
 * Only executable segments are touched. Prints how many instructions each rule replaced.
 */

import { readFileSync, writeFileSync } from "node:fs";

interface Rule {
  mask: number;
  value: number;
  replacement: number;
}

export const RULES: Record<string, Rule> = {
  "no-svc": { mask: 0xffffffff, value: 0xd4000001, replacement: 0x00000001 },
  // bit 21 tells mrs from msr
  "no-tpidr": { mask: 0xffdfffe0, value: 0xd51bd040, replacement: 0x00000002 },
  "no-tpidrro": { mask: 0xffffffe0, value: 0xd53bd060, replacement: 0x00000003 },
  "no-x18": { mask: 0xffffffe0, value: 0xaa1203e0, replacement: 0x00000004 },
  "no-x18-reload": { mask: 0xffffffff, value: 0xf9400bf2, replacement: 0xd503201f },
};

/**
 * Writes to `dst` the file `src` with the instructions of the rules replaced, and returns how many each rule
 * replaced, in the order of `names`. The first rule that matches an instruction replaces it.
 */
export function rewrite(src: string, dst: string, names: string[]): Map<string, number> {
  for (const name of names) {
    if (!(name in RULES)) throw new Error(`unknown rule ${name}: ${Object.keys(RULES).join(" ")}`);
  }
  const data = Buffer.from(readFileSync(src));
  const isElf = data.length >= 64 && data.subarray(0, 4).equals(Buffer.from("\x7fELF", "latin1"));
  if (!isElf || data[4] !== 2 || data.readUInt16LE(18) !== 183) throw new Error(`${src}: not an aarch64 ELF file`);
  const phoff = Number(data.readBigUInt64LE(32));
  const phentsize = data.readUInt16LE(54);
  const phnum = data.readUInt16LE(56);
  const counts = new Map<string, number>(names.map(name => [name, 0]));
  for (let i = 0; i < phnum; i++) {
    const header = phoff + i * phentsize;
    const type = data.readUInt32LE(header);
    const flags = data.readUInt32LE(header + 4);
    const offset = Number(data.readBigUInt64LE(header + 8));
    const filesz = Number(data.readBigUInt64LE(header + 32));
    if (type !== 1 || !(flags & 1)) continue;
    for (let at = offset; at < offset + filesz - 3; at += 4) {
      const word = data.readUInt32LE(at);
      for (const name of counts.keys()) {
        const rule = RULES[name]!;
        if ((word & rule.mask) >>> 0 === rule.value) {
          data.writeUInt32LE(rule.replacement, at);
          counts.set(name, counts.get(name)! + 1);
          break;
        }
      }
    }
  }
  writeFileSync(dst, data);
  return counts;
}

if (import.meta.main) {
  const [src, dst, ...names] = process.argv.slice(2);
  if (src === undefined || dst === undefined) {
    process.stderr.write(
      `usage: bun test/rewrite_insn.ts <in> <out> <rule>...\nrules: ${Object.keys(RULES).join(" ")}\n`,
    );
    process.exit(2);
  }
  const counts = rewrite(src, dst, names);
  console.log(`${dst}: ${[...counts].map(([name, count]) => `${name} ${count}`).join(", ")}`);
}
