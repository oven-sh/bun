#!/usr/bin/env bun
// The machine code of functions that were compiled ahead of time, out of the executable. Does not run it.
//
//   bun scripts/aot/disassemble.ts <executable> --map <map>                                  lists the functions
//   bun scripts/aot/disassemble.ts <executable> --map <map> <name or index>...               the code of those functions
//   bun scripts/aot/disassemble.ts <executable> [--map <map>] --offset <offset> --size <n>   the code at an offset
//
// See map.ts for the map. Offsets are in the image's code, as in the map and in a crash's trace (decode-trace.ts).
// Needs clang and llvm-objdump.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { hex, ImageMap, nameOf } from "./map.ts";

const { values, positionals } = parseArgs({
  options: { map: { type: "string" }, offset: { type: "string" }, size: { type: "string" } },
  allowPositionals: true,
});
const [executable, ...wanted] = positionals;
if (!executable || (!values.map && !(values.offset && values.size))) {
  console.error("usage: bun scripts/aot/disassemble.ts <executable> (--map <map> [name or index...] | --offset <n> --size <n>)");
  process.exit(1);
}
const map = values.map ? new ImageMap(values.map) : undefined;

if (!wanted.length && !values.offset) {
  console.log("index\toffset\tsize\tmodule\tstart\tkind\tname");
  for (const { index, offset, size, module, start, kind, name } of map!.functions)
    console.log([index, hex(offset), size, module, start, kind, name].join("\t"));
  process.exit(0);
}

// AOT::ImageHeader. The image is aligned to a page in the executable.
const file = readFileSync(executable);
let image = -1;
for (let at = 0; at + 40 <= file.length && image < 0; at += 16384) {
  if (file.toString("latin1", at, at + 8) === "BUNAOT01") image = at;
}
if (image < 0) {
  console.error(`${executable} has no image`);
  process.exit(1);
}
const code = image + Number(file.readBigUInt64LE(image + 24));
const sizeOfCode = Number(file.readBigUInt64LE(image + 32));

const directory = mkdtempSync(join(tmpdir(), "aot-disassemble-"));
function run(command: string, args: string[]) {
  const { stdout, stderr, status, error } = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (error) throw error;
  if (status) throw new Error(`${command}: ${stderr}`);
  return stdout;
}

function disassemble(offset: number, size: number) {
  if (!(offset >= 0 && size > 0 && offset + size <= sizeOfCode)) {
    console.error(`${hex(offset)} + ${size} is outside of the code`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(join(directory, "code.bin"), file.subarray(code + offset, code + offset + size));
  // A Mach-O object, on any host: in an ELF object what .incbin brings in is marked as data, and is not disassembled.
  writeFileSync(join(directory, "code.s"), `.text\n.incbin "${join(directory, "code.bin")}"\n`);
  run(process.env.CC ?? "clang", ["-c", "--target=arm64-apple-macos", join(directory, "code.s"), "-o", join(directory, "code.o")]);
  const listing = run(process.env.LLVM_OBJDUMP ?? "llvm-objdump", ["-d", "--no-show-raw-insn", join(directory, "code.o")]);
  for (const line of listing.split("\n")) {
    const [, address, instruction] = line.match(/^\s*([0-9a-f]+):\s*(.*)$/) ?? [];
    if (!address) continue;
    // The listing starts at zero. Addresses and the targets of branches are given as offsets in the image's code.
    const text = instruction.replace(/\s+/g, " ").replace(/0x([0-9a-f]+) <ltmp0\+0x[0-9a-f]+>/, (_, target) => {
      const to = offset + Number(BigInt.asIntN(64, BigInt("0x" + target)));
      return hex(to) + (map && !(to >= offset && to < offset + size) ? ` ; ${map.describe(to)}` : "");
    });
    console.log(`${hex(offset + parseInt(address, 16))}: ${text}`);
  }
}

try {
  if (values.offset) disassemble(Number(values.offset), Number(values.size));
  for (const which of wanted) {
    const found = map!.functions.filter(({ index, name }) => (/^\d+$/.test(which) ? index === +which : name === which));
    if (!found.length) {
      console.error(`the map has no function ${which}`);
      process.exitCode = 1;
    }
    for (const candidate of found) {
      console.log(`==== ${nameOf(candidate)}, kind ${candidate.kind}, ${candidate.size} bytes`);
      disassemble(candidate.offset, candidate.size);
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
