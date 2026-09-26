// Compares the Windows host INPUT FILE with the packed container as PE files.
//
//   bun tools/pe-compare.ts <host.exe> <packed.com> [--dumps DIR]
//
// The packer rewrites the headers of a linked host.exe: the PE header moves
// further in so that the APE magic and the shell script fit in front of it,
// and every file offset the format stores is corrected. This tool checks that
// nothing else changed. For both files it runs
//
//   llvm-readobj --file-headers --sections --coff-imports --coff-basereloc \
//                --coff-load-config --unwind
//
// which has to finish without an error on both, and compares the two dumps
// line by line:
//   - lines that name a FILE OFFSET (AddressOfNewExeHeader, SizeOfHeaders,
//     PointerToRawData) have to differ by exactly the move, and by nothing
//     else;
//   - the DOS header fields that the script overwrites are not compared (the
//     Magic and AddressOfNewExeHeader are);
//   - the name of the file in the first line is not compared;
//   - every other line, and their order, has to be the same: the sections,
//     the imports, the base relocations, the load config and the unwind data
//     of the packed file are the ones of the input.
// On top of the dumps it compares the raw bytes of every section, the COFF
// header and the optional header byte for byte at their new offsets.
//
// llvm-readobj reads a file; it does not run it. Nothing here says that the
// packed file runs on Windows.
import { mkdirSync, writeFileSync } from "node:fs";
import { decodeToc } from "./format.ts";
import { readPe } from "./pe.ts";

const LLVM = process.env.LLVM_BIN ?? "/usr/lib/llvm-current/bin";
export const READOBJ_ARGS = ["--file-headers", "--sections", "--coff-imports", "--coff-basereloc", "--coff-load-config", "--unwind"];

/** Lines whose value is a file offset: they move with the PE header. */
const SHIFTED = new Set(["AddressOfNewExeHeader", "SizeOfHeaders", "PointerToRawData"]);
/** DOS header fields that the shell script overwrites. */
const DOS_NOISE = new Set([
  "UsedBytesInTheLastPage",
  "FileSizeInPages",
  "NumberOfRelocationItems",
  "HeaderSizeInParagraphs",
  "MinimumExtraParagraphs",
  "MaximumExtraParagraphs",
  "InitialRelativeSS",
  "InitialSP",
  "Checksum",
  "InitialIP",
  "InitialRelativeCS",
  "AddressOfRelocationTable",
  "OverlayNumber",
  "OEMid",
  "OEMinfo",
]);

export type Dump = { ok: boolean; text: string; stderr: string };

export function readobj(path: string): Dump {
  const p = Bun.spawnSync({ cmd: [`${LLVM}/llvm-readobj`, ...READOBJ_ARGS, path], stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, text: p.stdout.toString(), stderr: p.stderr.toString() };
}

export type Difference = { line: number; input: string; packed: string; why: string };

export function compareDumps(input: string, packed: string, delta: number): Difference[] {
  const a = input.split("\n");
  const b = packed.split("\n");
  const out: Difference[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? "";
    const y = b[i] ?? "";
    if (x === y) continue;
    if (/^File: /.test(x) && /^File: /.test(y)) continue;
    const key = x.trim().match(/^([A-Za-z]+):/)?.[1];
    if (key && DOS_NOISE.has(key) && y.trim().startsWith(`${key}:`)) continue;
    if (key && SHIFTED.has(key) && y.trim().startsWith(`${key}:`)) {
      const value = (s: string) => {
        const v = s.trim().slice(key.length + 1).trim();
        return v.startsWith("0x") ? parseInt(v, 16) : Number(v);
      };
      const want = value(x) + delta;
      if (value(y) === want) continue;
      out.push({ line: i + 1, input: x.trim(), packed: y.trim(), why: `a file offset: expected ${want}, the input plus the move ${delta}` });
      continue;
    }
    out.push({ line: i + 1, input: x.trim(), packed: y.trim(), why: "the line differs and is not a file offset" });
  }
  return out;
}

export type Compare = {
  delta: number;
  lines: number;
  differences: Difference[];
  bytes: { what: string; ok: boolean; detail?: string }[];
  inputDump: string;
  packedDump: string;
};

export function comparePe(inputPath: string, packedPath: string): Compare {
  const input = Buffer.from(require("node:fs").readFileSync(inputPath));
  const packed = Buffer.from(require("node:fs").readFileSync(packedPath));
  const toc = decodeToc(packed);
  if (!toc) throw new Error(`${packedPath} has no BUNPACK1 table of contents`);
  const hostPe = readPe(input);
  const packedPe = readPe(packed);
  const delta = toc.headerSize - hostPe.lfanew;

  const a = readobj(inputPath);
  const b = readobj(packedPath);
  const bytes: Compare["bytes"] = [];
  const check = (ok: boolean, what: string, detail?: string) => bytes.push({ ok, what, detail });
  check(a.ok, `llvm-readobj reads the input host ${inputPath.replace(/.*\//, "")}`, a.stderr.trim() || undefined);
  check(b.ok, `llvm-readobj reads the packed file ${packedPath.replace(/.*\//, "")}`, b.stderr.trim() || undefined);
  check(!b.stderr.trim(), "llvm-readobj says nothing on stderr for the packed file", b.stderr.trim() || undefined);

  // The COFF header, the optional header and the section table, byte for byte
  // at their new place, with the stored file offsets taken out of the picture
  // (they are what the dump comparison above checks).
  const headerLen = 4 + 20 + hostPe.optionalHeaderSize + 40 * hostPe.sectionCount;
  const ha = Buffer.from(input.subarray(hostPe.lfanew, hostPe.lfanew + headerLen));
  const hb = Buffer.from(packed.subarray(toc.headerSize, toc.headerSize + headerLen));
  for (const buf of [ha, hb]) {
    const opt = 4 + 20;
    buf.writeUInt32LE(0, opt + 60); // SizeOfHeaders
    buf.writeUInt32LE(0, opt + 64); // CheckSum
    buf.writeUInt32LE(0, 4 + 8); // PointerToSymbolTable
    if (hostPe.dataDirectoryCount > 4) buf.writeUInt32LE(0, opt + 112 + 4 * 8); // certificate table
    const sectionTable = opt + hostPe.optionalHeaderSize;
    for (let i = 0; i < hostPe.sectionCount; i++) {
      buf.writeUInt32LE(0, sectionTable + 40 * i + 20);
      buf.writeUInt32LE(0, sectionTable + 40 * i + 24);
      buf.writeUInt32LE(0, sectionTable + 40 * i + 28);
    }
  }
  check(ha.equals(hb), "the COFF header, the optional header and the section table are the same bytes apart from the file offsets");
  check(
    packedPe.sections.length === hostPe.sections.length &&
      packedPe.sections.every((s, i) => {
        const t = hostPe.sections[i];
        return s.name === t.name && s.virtualAddress === t.virtualAddress && s.virtualSize === t.virtualSize && s.rawSize === t.rawSize;
      }),
    "the sections have the same names, addresses and sizes",
  );
  let sameBytes = true;
  let which = "";
  for (const [i, s] of hostPe.sections.entries()) {
    if (!s.rawSize) continue;
    const t = packedPe.sections[i];
    if (t.rawPointer !== s.rawPointer + delta) {
      sameBytes = false;
      which = `${s.name}: raw data at 0x${t.rawPointer.toString(16)}, expected 0x${(s.rawPointer + delta).toString(16)}`;
      break;
    }
    if (!input.subarray(s.rawPointer, s.rawPointer + s.rawSize).equals(packed.subarray(t.rawPointer, t.rawPointer + t.rawSize))) {
      sameBytes = false;
      which = `${s.name}: the raw data differs`;
      break;
    }
  }
  check(sameBytes, `the raw data of every section is the same bytes, moved by ${delta}`, which || undefined);
  check(packedPe.checkSum === 0, "the packed file has CheckSum 0");
  check(
    packedPe.sizeOfHeaders === hostPe.sizeOfHeaders + delta && packedPe.sizeOfHeaders <= packedPe.headerRoom,
    "SizeOfHeaders grew by the move and stays at or below the first section RVA",
    `0x${packedPe.sizeOfHeaders.toString(16)} vs room 0x${packedPe.headerRoom.toString(16)}`,
  );

  const differences = a.ok && b.ok ? compareDumps(a.text, b.text, delta) : [];
  return { delta, lines: a.text.split("\n").length, differences, bytes, inputDump: a.text, packedDump: b.text };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [inputPath, packedPath] = args;
  if (!inputPath || !packedPath) throw new Error("usage: bun tools/pe-compare.ts <host.exe> <packed.com> [--dumps DIR]");
  const r = comparePe(inputPath, packedPath);
  const dumps = args.indexOf("--dumps");
  if (dumps >= 0) {
    mkdirSync(args[dumps + 1], { recursive: true });
    writeFileSync(`${args[dumps + 1]}/${inputPath.replace(/.*\//, "")}.readobj.txt`, r.inputDump);
    writeFileSync(`${args[dumps + 1]}/${packedPath.replace(/.*\//, "")}.readobj.txt`, r.packedDump);
  }
  for (const c of r.bytes) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `  [${c.detail}]` : ""}`);
  for (const d of r.differences) console.log(`FAIL line ${d.line}: ${d.why}\n     input:  ${d.input}\n     packed: ${d.packed}`);
  const failed = r.bytes.filter(c => !c.ok).length + r.differences.length;
  console.log(
    `${packedPath}: the PE header moved by ${r.delta} bytes; ${r.lines} lines of llvm-readobj (${READOBJ_ARGS.join(" ")}) compared, ` +
      `${r.differences.length} unexpected differences, ${r.bytes.filter(c => c.ok).length} of ${r.bytes.length} byte checks passed`,
  );
  console.log("This is a static check. The packed file has NOT been run on Windows.");
  if (failed) process.exit(1);
}
