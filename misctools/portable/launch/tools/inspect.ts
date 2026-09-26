// Reads a packed file back and checks it, without the code that packed it.
//
//   bun tools/inspect.ts <packed file> [--json out.json]
//
// What it checks
//   - the APE magic, the newline after it, the quoted string that holds
//     e_lfanew, and that the script part is text with no NUL byte outside it
//   - the table of contents: both magics, the size of the file, the parts in
//     order, inside the file and aligned (image 64 KiB, stubs 512)
//   - the numbers the shell header prints are the numbers of the table of
//     contents (it runs the header with BUN_PORTABLE_PARTS=1 in /bin/sh)
//   - the PE file: MZ, the PE signature at e_lfanew, SizeOfHeaders at or
//     below the first section RVA, every section aligned and inside the file,
//     CheckSum 0, and that the Windows host ends before the stubs
//   - the ELF image at image_off: machine, and every loadable segment 64 KiB
//     aligned in the container and inside it
//   - the loader stubs: ELF or Mach-O for the architecture of the image
//   - the Apple code signature, through tools/check_signature.ts
import { createHash } from "node:crypto";
import {
  APE_MAGIC,
  ELF_MACHINE,
  IMAGE_ALIGN,
  QUOTE_END,
  STUB_ALIGN,
  TOC_MAGIC,
  TOC_SIZE,
  archOfMachine,
  decodeToc,
} from "./format.ts";
import { machineName, readPe } from "./pe.ts";
import { checkSignature } from "./check_signature.ts";

export type Check = { ok: boolean; what: string; detail?: string };

export function inspect(
  file: Buffer,
  opt: { shell?: string; path?: string } = {},
): { checks: Check[]; facts: Record<string, unknown> } {
  const checks: Check[] = [];
  const facts: Record<string, unknown> = {};
  const ok = (cond: boolean, what: string, detail?: string) => checks.push({ ok: !!cond, what, detail });

  /* ---- the first bytes and the script ---- */
  ok(file.toString("latin1", 0, 8) === APE_MAGIC, `the file starts with the APE magic ${APE_MAGIC}`);
  ok(file[8] === 0x0a, "a newline follows the magic");
  const lfanew = file.readUInt32LE(0x3c);
  const quote = file.indexOf(0x27, 9);
  ok(
    quote === QUOTE_END,
    `the quoted string of the first line ends at 0x${QUOTE_END.toString(16)}`,
    `ends at 0x${quote.toString(16)}`,
  );
  const script = file.subarray(QUOTE_END + 2, lfanew);
  ok(!script.includes(0), "the script after the quote has no NUL byte");
  ok(
    script.every(b => b === 0x0a || b === 0x09 || (b >= 0x20 && b < 0x7f)),
    "the script after the quote is printable text",
  );

  /* ---- the table of contents ---- */
  const toc = decodeToc(file);
  if (!toc) {
    ok(false, `a ${TOC_MAGIC} table of contents in the last ${TOC_SIZE} bytes`);
    return { checks, facts };
  }
  facts.toc = toc;
  ok(toc.version === 1, "table of contents version 1");
  ok(
    toc.fileSize === file.length,
    "the table of contents gives the size of the file",
    `${toc.fileSize} vs ${file.length}`,
  );
  ok(toc.headerSize === lfanew, "header_size is e_lfanew", `${toc.headerSize} vs ${lfanew}`);
  const arch = archOfMachine(toc.arch);
  ok(!!arch, "the architecture in the table of contents is known", String(toc.arch));
  facts.arch = arch;
  ok(toc.imageOff % IMAGE_ALIGN === 0, "the image starts on a 64 KiB boundary", `0x${toc.imageOff.toString(16)}`);
  ok(toc.imageOff + toc.imageLen <= file.length, "the image is inside the file");
  ok(
    toc.stubLinuxLen > 0 && toc.stubLinuxOff % STUB_ALIGN === 0,
    "the Linux stub is there and starts on a 512 byte boundary",
  );
  ok(toc.stubLinuxOff + toc.stubLinuxLen <= toc.imageOff, "the Linux stub is in front of the image");
  if (toc.stubMacosLen) {
    ok(toc.stubMacosOff % STUB_ALIGN === 0, "the macOS stub starts on a 512 byte boundary");
    ok(toc.stubMacosOff + toc.stubMacosLen <= toc.imageOff, "the macOS stub is in front of the image");
  } else {
    ok(toc.stubMacosOff === 0, "a file without a macOS stub has no macOS stub offset");
  }

  /* ---- what the shell header says ---- */
  if (opt.path) {
    const p = Bun.spawnSync({
      cmd: [opt.shell ?? "/bin/sh", opt.path],
      env: { BUN_PORTABLE_PARTS: "1", PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const line = p.stdout.toString().trim();
    const want =
      `arch ${arch} image ${toc.imageOff} ${toc.imageLen} ` +
      `stub_linux ${toc.stubLinuxOff} ${toc.stubLinuxLen} ${key(file, toc.stubLinuxOff, toc.stubLinuxLen)} ` +
      `stub_macos ${toc.stubMacosOff} ${toc.stubMacosLen} ${key(file, toc.stubMacosOff, toc.stubMacosLen)}`;
    ok(
      line === want,
      "the numbers in the shell header are the numbers in the table of contents",
      line === want ? line : `${line} != ${want}`,
    );
  }

  /* ---- the PE file ---- */
  const pe = readPe(file);
  facts.pe = {
    machine: machineName(pe.machine),
    sections: pe.sections.length,
    sizeOfHeaders: pe.sizeOfHeaders,
    checkSum: pe.checkSum,
    end: pe.end,
  };
  ok(machineName(pe.machine) === arch, "the PE machine is the architecture of the image", machineName(pe.machine));
  ok(
    pe.sizeOfHeaders <= pe.headerRoom,
    "SizeOfHeaders is at or below the first section RVA",
    `0x${pe.sizeOfHeaders.toString(16)} vs 0x${pe.headerRoom.toString(16)}`,
  );
  ok(
    pe.sizeOfHeaders >= lfanew + 4 + 20 + pe.optionalHeaderSize + 40 * pe.sectionCount,
    "SizeOfHeaders covers the script, the PE header and the section table",
  );
  const badSection = pe.sections.find(
    s => s.rawSize && (s.rawPointer % pe.fileAlignment || s.rawPointer + s.rawSize > file.length),
  );
  ok(!badSection, "every section is aligned to FileAlignment and inside the file", badSection?.name);
  ok(
    pe.end <= toc.stubLinuxOff,
    "the Windows host ends in front of the Linux stub",
    `0x${pe.end.toString(16)} vs 0x${toc.stubLinuxOff.toString(16)}`,
  );
  ok(pe.checkSum === 0, "the PE checksum field is 0: what lld writes, and what signtool replaces");

  /* ---- the image ---- */
  const image = file.subarray(toc.imageOff, toc.imageOff + toc.imageLen);
  ok(image.toString("latin1", 0, 4) === "\x7fELF", "the image is an ELF file");
  ok(image.readUInt16LE(18) === toc.arch, "the ELF machine of the image is the one in the table of contents");
  ok(image.readUInt16LE(16) === 3, "the image is a PIE (ELF type DYN)", String(image.readUInt16LE(16)));
  const phoff = Number(image.readBigUInt64LE(32));
  const phentsize = image.readUInt16LE(54);
  const phnum = image.readUInt16LE(56);
  let loads = 0;
  let misaligned = -1;
  for (let i = 0; i < phnum; i++) {
    const at = phoff + i * phentsize;
    if (image.readUInt32LE(at) !== 1) continue;
    loads++;
    const offset = Number(image.readBigUInt64LE(at + 8));
    const vaddr = Number(image.readBigUInt64LE(at + 16));
    const filesz = Number(image.readBigUInt64LE(at + 32));
    if ((offset | vaddr) % IMAGE_ALIGN || (toc.imageOff + offset) % IMAGE_ALIGN) misaligned = i;
    if (toc.imageOff + offset + filesz > file.length) misaligned = i;
  }
  facts.imageLoadSegments = loads;
  ok(loads > 0, "the image has loadable segments");
  ok(
    misaligned < 0,
    "every loadable segment is 64 KiB aligned in the packed file and inside it",
    misaligned < 0 ? undefined : `segment ${misaligned}`,
  );

  /* ---- the stubs ---- */
  const linux = file.subarray(toc.stubLinuxOff, toc.stubLinuxOff + toc.stubLinuxLen);
  ok(linux.toString("latin1", 0, 4) === "\x7fELF", "the Linux stub is an ELF file");
  ok(linux.readUInt16LE(18) === toc.arch, "the Linux stub is for the architecture of the image");
  facts.stubLinuxSha256 = createHash("sha256").update(linux).digest("hex");
  if (toc.stubMacosLen) {
    const mac = file.subarray(toc.stubMacosOff, toc.stubMacosOff + toc.stubMacosLen);
    const magic = mac.readUInt32LE(0);
    ok(
      magic === 0xfeedfacf || magic === 0xcafebabe,
      "the macOS stub is a 64 bit Mach-O or a fat Mach-O",
      `0x${magic.toString(16)}`,
    );
    if (magic === 0xfeedfacf) {
      const cpu = mac.readUInt32LE(4);
      ok(
        cpu === (toc.arch === ELF_MACHINE.aarch64 ? 0x100000c : 0x1000007),
        "the macOS stub is for the architecture of the image",
        `cpu 0x${cpu.toString(16)}`,
      );
    }
    facts.stubMacosSha256 = createHash("sha256").update(mac).digest("hex");
  }

  /* ---- the Apple code signature ---- */
  if (!toc.sigLen) {
    facts.signature = "none";
    ok(toc.codeLen === 0 && toc.sigOff === 0 && toc.codeOff === 0, "an unsigned file names no signed range");
    return { checks, facts };
  }
  const sig = checkSignature(file);
  for (const c of sig.checks) checks.push(c);
  facts.signature = { codeOff: toc.codeOff, codeLen: toc.codeLen, sigOff: toc.sigOff, sigLen: toc.sigLen };
  return { checks, facts };
}

function key(file: Buffer, off: number, len: number): string {
  return len
    ? createHash("sha256")
        .update(file.subarray(off, off + len))
        .digest("hex")
        .slice(0, 16)
    : "-";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const path = args[0];
  if (!path) throw new Error("usage: bun tools/inspect.ts <packed file> [--json out.json]");
  const file = Buffer.from(await Bun.file(path).arrayBuffer());
  const { checks, facts } = inspect(file, { path });
  for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.what}${c.detail ? `  [${c.detail}]` : ""}`);
  const failed = checks.filter(c => !c.ok).length;
  console.log(`${path}: ${checks.length - failed} of ${checks.length} checks passed`);
  const json = args.indexOf("--json");
  if (json >= 0) await Bun.write(args[json + 1], JSON.stringify({ path, checks, facts }, null, 2) + "\n");
  if (failed) process.exit(1);
}
