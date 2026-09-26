// The packer: {ELF image, Windows host, loader stubs} -> ONE file per CPU
// architecture that starts by itself on Windows, Linux and macOS.
//
//   bun tools/pack.ts --arch x86_64 --image build/portable/x86_64/threads.img \
//       --win-host build/portable/inputs/windows/host-x64.exe \
//       --linux-stub build/portable/launch/stub/linux-stub-x86_64 \
//       [--macos-stub macos-stub-x86_64] [--sign|--no-sign] \
//       -o threads-x86_64.com [--json threads-x86_64.json]
//
// --macos-stub may be left out: a Mach-O stub can only be linked on a Mac.
// The shell header of the packed file then says so on macOS and exits 1.
//
// The layout and the table of contents are in tools/format.ts. Packing is a
// pure function of its inputs.
import { createHash } from "node:crypto";
import {
  ELF_MACHINE,
  IMAGE_ALIGN,
  QUOTE_END,
  STUB_ALIGN,
  TOC_SIZE,
  TOC_VERSION,
  alignUp,
  buildHeader,
  encodeToc,
  scriptBody,
  type Arch,
  type ScriptNumbers,
} from "./format.ts";
import { clearCheckSum, headerRoomFor, machineName, movePe, readPe } from "./pe.ts";
import { signature, signatureLength, signedLength } from "./apple_sign.ts";

export type PackInput = {
  arch: Arch;
  image: Buffer;
  winHost: Buffer;
  linuxStub: Buffer;
  macosStub?: Buffer;
  sign: boolean;
};

export type PackReport = {
  arch: Arch;
  headerSize: number;
  scriptSize: number;
  headerRoom: number;
  peDelta: number;
  peSizeOfHeaders: number;
  winHostEnd: number;
  stubLinuxOff: number;
  stubLinuxLen: number;
  stubLinuxKey: string;
  stubMacosOff: number;
  stubMacosLen: number;
  stubMacosKey: string;
  imageOff: number;
  imageLen: number;
  codeOff: number;
  codeLen: number;
  sigOff: number;
  sigLen: number;
  tocOff: number;
  fileSize: number;
};

/** The first 16 hex digits of the SHA-256 of a part: what the cache name has. */
export function partKey(b: Buffer): string {
  return b.length ? createHash("sha256").update(b).digest("hex").slice(0, 16) : "-";
}

/**
 * misctools/portable/build.ts signs an aarch64 image on its own
 * (../../tools/apple_sign.ts: padding, blob and a BUNSIG01 trailer). That signature
 * is for the image as a file of its own; the container signs the image again
 * at its offsets in the container, so the old one comes off here.
 */
export function stripImageSignature(image: Buffer): Buffer {
  if (image.length < 40) return image;
  const trailer = image.subarray(image.length - 40);
  if (trailer.toString("latin1", 32, 40) !== "BUNSIG01") return image;
  const codeLen = Number(trailer.readBigUInt64LE(8));
  if (codeLen > image.length) throw new Error("the image has a BUNSIG01 trailer with an impossible length");
  return image.subarray(0, codeLen);
}

export type Load = { offset: number; vaddr: number; filesz: number; memsz: number; flags: number };

export function imageSegments(image: Buffer): { machine: number; entry: number; loads: Load[] } {
  if (image.toString("latin1", 0, 4) !== "\x7fELF") throw new Error("the image is not an ELF file");
  const machine = image.readUInt16LE(18);
  const entry = Number(image.readBigUInt64LE(24));
  const phoff = Number(image.readBigUInt64LE(32));
  const phentsize = image.readUInt16LE(54);
  const phnum = image.readUInt16LE(56);
  const loads: Load[] = [];
  for (let i = 0; i < phnum; i++) {
    const at = phoff + i * phentsize;
    if (image.readUInt32LE(at) !== 1) continue;
    loads.push({
      flags: image.readUInt32LE(at + 4),
      offset: Number(image.readBigUInt64LE(at + 8)),
      vaddr: Number(image.readBigUInt64LE(at + 16)),
      filesz: Number(image.readBigUInt64LE(at + 32)),
      memsz: Number(image.readBigUInt64LE(at + 40)),
    });
  }
  return { machine, entry, loads };
}

export function pack(input: PackInput): { file: Buffer; report: PackReport } {
  const image = stripImageSignature(input.image);
  const { machine, loads } = imageSegments(image);
  if (machine !== ELF_MACHINE[input.arch]) {
    throw new Error(`the image is for ELF machine ${machine}, --arch ${input.arch} wants ${ELF_MACHINE[input.arch]}`);
  }
  if (!loads.length) throw new Error("the image has no loadable segments");
  // Windows file views and 64 KiB page systems map the segments where they
  // lie, so every segment keeps its 64 KiB alignment inside the container.
  for (const [i, l] of loads.entries()) {
    if ((l.offset | l.vaddr) % IMAGE_ALIGN) {
      throw new Error(
        `segment ${i} of the image is at file offset 0x${l.offset.toString(16)}, address 0x${l.vaddr.toString(16)}: not 64 KiB aligned`,
      );
    }
  }
  const hostPe = readPe(input.winHost);
  if (machineName(hostPe.machine) !== input.arch) {
    throw new Error(`the Windows host is for ${machineName(hostPe.machine)}, --arch says ${input.arch}`);
  }
  const linuxStub = input.linuxStub;
  const macosStub = input.macosStub ?? Buffer.alloc(0);
  if (!linuxStub.length) throw new Error("the Linux loader stub is empty");

  const keys = { linux: partKey(linuxStub), macos: partKey(macosStub) };
  const room = headerRoomFor(input.winHost);

  function place(headerSize: number) {
    const moved = movePe(input.winHost, headerSize);
    const stubLinuxOff = alignUp(moved.end, STUB_ALIGN);
    const afterLinux = stubLinuxOff + linuxStub.length;
    const stubMacosOff = macosStub.length ? alignUp(afterLinux, STUB_ALIGN) : 0;
    const afterStubs = macosStub.length ? stubMacosOff + macosStub.length : afterLinux;
    const imageOff = alignUp(afterStubs, IMAGE_ALIGN);
    const codeLen = input.sign ? signedLength(image.length) : 0;
    const sigLen = input.sign ? signatureLength(codeLen) : 0;
    const sigOff = input.sign ? imageOff + codeLen : 0;
    const tail = input.sign ? sigOff + sigLen : imageOff + image.length;
    const tocOff = alignUp(tail, 8);
    const numbers: ScriptNumbers = {
      arch: input.arch,
      imageOff,
      imageLen: image.length,
      stubLinuxOff,
      stubLinuxLen: linuxStub.length,
      stubLinuxKey: keys.linux,
      stubMacosOff,
      stubMacosLen: macosStub.length,
      stubMacosKey: keys.macos,
    };
    const script = QUOTE_END + 2 + scriptBody(numbers).length;
    return { moved, imageOff, codeLen, sigLen, sigOff, tocOff, fileSize: tocOff + TOC_SIZE, numbers, script };
  }

  // The script sits in front of the PE header, so its length decides where
  // the PE header goes, and that decides the offsets the script prints. One
  // pass per candidate place settles it: the offsets only grow with
  // headerSize, and so does the room the script needs, by a digit at a time.
  let headerSize = hostPe.lfanew;
  let layout = place(headerSize);
  while (layout.script > headerSize) {
    headerSize += hostPe.fileAlignment;
    if (headerSize > room) {
      throw new Error(
        `the script needs ${layout.script} bytes but this Windows host leaves only ${room}: ` +
          `SizeOfHeaders 0x${hostPe.sizeOfHeaders.toString(16)}, first section RVA 0x${hostPe.headerRoom.toString(16)}`,
      );
    }
    layout = place(headerSize);
  }

  const file = Buffer.alloc(layout.fileSize);
  buildHeader(headerSize, headerSize, layout.numbers).copy(file, 0);
  layout.moved.body.copy(file, headerSize);
  const { stubLinuxOff, stubMacosOff } = layout.numbers;
  linuxStub.copy(file, stubLinuxOff);
  if (macosStub.length) macosStub.copy(file, stubMacosOff);
  image.copy(file, layout.imageOff);
  clearCheckSum(file, headerSize);
  if (input.sign) {
    // The last step of packing: the hashes are of the pages of the finished
    // file. Nothing inside the signed range may change after this.
    const blob = signature(file.subarray(layout.imageOff, layout.imageOff + layout.codeLen));
    if (blob.length !== layout.sigLen)
      throw new Error("the signature came out with a length the layout did not reserve");
    blob.copy(file, layout.sigOff);
  }
  encodeToc({
    version: TOC_VERSION,
    fileSize: layout.fileSize,
    arch: machine,
    headerSize,
    imageOff: layout.imageOff,
    imageLen: image.length,
    codeOff: input.sign ? layout.imageOff : 0,
    codeLen: layout.codeLen,
    sigOff: layout.sigOff,
    sigLen: layout.sigLen,
    stubLinuxOff,
    stubLinuxLen: linuxStub.length,
    stubMacosOff,
    stubMacosLen: macosStub.length,
  }).copy(file, layout.tocOff);

  return {
    file,
    report: {
      arch: input.arch,
      headerSize,
      scriptSize: layout.script,
      headerRoom: room,
      peDelta: layout.moved.delta,
      peSizeOfHeaders: hostPe.sizeOfHeaders + layout.moved.delta,
      winHostEnd: layout.moved.end,
      stubLinuxOff,
      stubLinuxLen: linuxStub.length,
      stubLinuxKey: keys.linux,
      stubMacosOff,
      stubMacosLen: macosStub.length,
      stubMacosKey: keys.macos,
      imageOff: layout.imageOff,
      imageLen: image.length,
      codeOff: input.sign ? layout.imageOff : 0,
      codeLen: layout.codeLen,
      sigOff: layout.sigOff,
      sigLen: layout.sigLen,
      tocOff: layout.tocOff,
      fileSize: layout.fileSize,
    },
  };
}

/* ---- command line ---- */
if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt: Record<string, string> = {};
  let sign: boolean | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--sign") sign = true;
    else if (a === "--no-sign") sign = false;
    else if (a === "-o") opt.out = args[++i];
    else if (a.startsWith("--")) opt[a.slice(2)] = args[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  for (const need of ["arch", "image", "win-host", "linux-stub", "out"]) {
    if (!opt[need]) throw new Error(`missing --${need}`);
  }
  const arch = opt.arch as Arch;
  if (!(arch in ELF_MACHINE)) throw new Error("--arch has to be x86_64 or aarch64");
  const read = async (p: string) => Buffer.from(await Bun.file(p).arrayBuffer());
  const { file, report: r } = pack({
    arch,
    image: await read(opt.image),
    winHost: await read(opt["win-host"]),
    linuxStub: await read(opt["linux-stub"]),
    macosStub: opt["macos-stub"] ? await read(opt["macos-stub"]) : undefined,
    // An aarch64 image needs the signature to run on Apple Silicon; an
    // x86_64 one does not, and an unsigned container is 1/128 smaller.
    sign: sign ?? arch === "aarch64",
  });
  await Bun.write(opt.out, file);
  await Bun.$`chmod 755 ${opt.out}`.quiet();
  if (opt.json) await Bun.write(opt.json, JSON.stringify(r, null, 2) + "\n");
  const hex = (n: number) => `0x${n.toString(16)}`;
  console.log(
    `packed ${opt.out}: ${r.fileSize} bytes\n` +
      `  shell header   ${r.scriptSize} bytes of script, PE header at ${hex(r.headerSize)} (moved by ${r.peDelta}, room ${hex(r.headerRoom)})\n` +
      `  windows host   up to ${hex(r.winHostEnd)}, SizeOfHeaders ${hex(r.peSizeOfHeaders)}\n` +
      `  linux stub     ${hex(r.stubLinuxOff)} + ${r.stubLinuxLen} (${r.stubLinuxKey})\n` +
      `  macos stub     ${r.stubMacosLen ? `${hex(r.stubMacosOff)} + ${r.stubMacosLen} (${r.stubMacosKey})` : "absent"}\n` +
      `  image          ${hex(r.imageOff)} + ${r.imageLen}\n` +
      `  signature      ${r.sigLen ? `covers ${r.codeLen} bytes from ${hex(r.codeOff)}, blob ${hex(r.sigOff)} + ${r.sigLen}` : "none"}\n` +
      `  contents       ${hex(r.tocOff)} + ${TOC_SIZE}`,
  );
}
