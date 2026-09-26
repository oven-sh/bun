// The packed portable image: one file per CPU architecture that starts by
// itself on Windows, Linux and macOS. This module holds the layout, the table
// of contents and the shell header. Nothing here reads or writes files.
//
// The file is at the same time
//   - a PE executable for Windows. It starts with the APE magic "MZqFpD='",
//     whose first two bytes are the "MZ" that Windows wants; the shell script
//     sits where the DOS stub normally goes, and the PE header is reached
//     through e_lfanew at offset 0x3c. Its code is the Windows host, which
//     finds the image inside its own file.
//   - a shell script for sh, dash, bash, zsh and busybox sh. The kernel
//     answers ENOEXEC for a file that starts with MZ, the shell then reads it
//     as a script, writes the loader stub of this OS and architecture into a
//     per-user cache directory once and execs it with the path of this file.
//   - the container of the ELF image, at a 64 KiB boundary, so that Windows
//     file views and 16 KiB / 64 KiB page systems map it where it lies.
//
// Layout, offsets growing down:
//
//   0x00            "MZqFpD='" and a newline                      9 bytes
//   0x09            second line of the script, inside the quote    51 bytes
//   0x3c            e_lfanew, 4 bytes, inside the quote
//   0x40            "'" and a newline, the quote ends              2 bytes
//   0x42            the body of the script, then a comment as padding
//   header_size     PE signature, COFF header, optional header, section table
//   ...             the sections of the Windows host, as linked
//   512 boundary    the Linux loader stub                      stub_linux_off
//   512 boundary    the macOS loader stub, may be absent       stub_macos_off
//   64 KiB boundary the ELF image                              image_off
//   16 KiB boundary the Apple code signature of the image      sig_off
//   8 boundary      the table of contents, 128 bytes           file_size - 128
//
// The image is the last big part: "bun build --compile" appends its module
// graph to a section of the ELF image, and a re-pack of the grown image puts
// it at the same offset, because only the signature and the table of contents
// follow it.
//
// Packing is a pure function of its inputs: no time, no randomness, no
// environment, no path of the machine that packed.

export const APE_MAGIC = "MZqFpD='";
export const TOC_MAGIC = "BUNPACK1";
export const TOC_SIZE = 128;
export const TOC_VERSION = 1;
/** Windows file views and 16/64 KiB page systems: the image starts here. */
export const IMAGE_ALIGN = 0x10000;
/** The Apple signature hashes 4 KiB pages; its range is whole 16 KiB pages. */
export const APPLE_PAGE = 0x4000;
/** The stubs start here, so that `dd bs=512 skip=...` reaches them. */
export const STUB_ALIGN = 512;
/** Where the quoted string of the header ends, right after e_lfanew. */
export const QUOTE_END = 0x40;

export const ELF_MACHINE = { x86_64: 62, aarch64: 183 } as const;
export type Arch = keyof typeof ELF_MACHINE;

export function alignUp(n: number, to: number): number {
  return Math.ceil(n / to) * to;
}

export function archOfMachine(machine: number): Arch | undefined {
  return (Object.keys(ELF_MACHINE) as Arch[]).find(a => ELF_MACHINE[a] === machine);
}

/* ---- the table of contents ----
   The last TOC_SIZE bytes of the file. Every reader finds the parts through
   it: the Windows host (its own file), the Linux stub, the macOS stub, and the
   checking tools. All numbers are little endian, the magic is at both ends so
   that a truncated file cannot look like a table of contents. */
export type Toc = {
  version: number;
  fileSize: number;
  /** ELF machine number of the image: 62 (x86-64) or 183 (arm64). */
  arch: number;
  /** e_lfanew: the size of the shell header, where the PE header starts. */
  headerSize: number;
  imageOff: number;
  imageLen: number;
  /** The Apple signed range, [codeOff, codeOff+codeLen). 0 when unsigned. */
  codeOff: number;
  codeLen: number;
  sigOff: number;
  sigLen: number;
  stubLinuxOff: number;
  stubLinuxLen: number;
  stubMacosOff: number;
  stubMacosLen: number;
};

/** Field order of the table of contents, after magic, version and size. */
const TOC_FIELDS = [
  "fileSize",
  "arch",
  "headerSize",
  "imageOff",
  "imageLen",
  "codeOff",
  "codeLen",
  "sigOff",
  "sigLen",
  "stubLinuxOff",
  "stubLinuxLen",
  "stubMacosOff",
  "stubMacosLen",
] as const satisfies readonly (keyof Toc)[];

export function encodeToc(t: Toc): Buffer {
  const b = Buffer.alloc(TOC_SIZE);
  b.write(TOC_MAGIC, 0, "latin1");
  b.writeUInt32LE(t.version, 8);
  b.writeUInt32LE(TOC_SIZE, 12);
  TOC_FIELDS.forEach((name, i) => b.writeBigUInt64LE(BigInt(t[name]), 16 + 8 * i));
  b.write(TOC_MAGIC, TOC_SIZE - 8, "latin1");
  return b;
}

export function decodeToc(file: Buffer): Toc | null {
  if (file.length < TOC_SIZE) return null;
  const b = file.subarray(file.length - TOC_SIZE);
  if (b.toString("latin1", 0, 8) !== TOC_MAGIC) return null;
  if (b.toString("latin1", TOC_SIZE - 8, TOC_SIZE) !== TOC_MAGIC) return null;
  const toc = { version: b.readUInt32LE(8) } as Toc;
  TOC_FIELDS.forEach((name, i) => (toc[name] = Number(b.readBigUInt64LE(16 + 8 * i))));
  return toc;
}

/* ---- the shell header ----
   Everything in front of the PE signature is the script. The first line is the
   APE magic, which a shell reads as the start of a single-quoted string: the
   bytes up to the closing quote at QUOTE_END, e_lfanew among them, are that
   string and are never run. Then comes the script. It uses POSIX sh and the
   programs uname, mkdir, dd, chmod and mv, nothing else: no rm (a failed dd
   leaves its temporary file behind and says so), no gzip, no od, no cksum. */
export type ScriptNumbers = {
  arch: Arch;
  imageOff: number;
  imageLen: number;
  stubLinuxOff: number;
  stubLinuxLen: number;
  stubLinuxKey: string;
  stubMacosOff: number;
  stubMacosLen: number;
  stubMacosKey: string;
};

/** The script after the quoted string that holds e_lfanew. */
export function scriptBody(n: ScriptNumbers): string {
  const machines = n.arch === "x86_64" ? "x86_64|amd64|x64" : "aarch64|arm64";
  return `# A Bun portable image for ${n.arch}: a Windows executable, a shell script and
# an ELF image in one file. These numbers are the ones in the table of
# contents in the last ${TOC_SIZE} bytes of this file.
image_off=${n.imageOff} image_len=${n.imageLen}
stub_linux_off=${n.stubLinuxOff} stub_linux_len=${n.stubLinuxLen} stub_linux_key=${n.stubLinuxKey}
stub_macos_off=${n.stubMacosOff} stub_macos_len=${n.stubMacosLen} stub_macos_key=${n.stubMacosKey}
if [ -n "\${BUN_PORTABLE_PARTS-}" ]; then
echo "arch ${n.arch} image $image_off $image_len stub_linux $stub_linux_off $stub_linux_len $stub_linux_key stub_macos $stub_macos_off $stub_macos_len $stub_macos_key"
exit 0
fi
system=$(uname -s) || exit 1
machine=$(uname -m) || exit 1
case $machine in
${machines}) ;;
*) echo "$0: this file holds an image for ${n.arch}, this machine is $machine" >&2; exit 1 ;;
esac
case $system in
Linux) os=linux off=$stub_linux_off len=$stub_linux_len key=$stub_linux_key ;;
Darwin) os=macos off=$stub_macos_off len=$stub_macos_len key=$stub_macos_key ;;
*) echo "$0: $system is not one of Linux, Darwin and Windows" >&2; exit 1 ;;
esac
if [ "$len" -eq 0 ]; then
echo "$0: this file was packed without a $os loader stub for ${n.arch}" >&2
exit 1
fi
dir=\${BUN_PORTABLE_CACHE:-\${XDG_CACHE_HOME:-\${HOME:-\${TMPDIR:-/tmp}}/.cache}/bun-portable}
stub=$dir/stub-$os-${n.arch}-$key
if [ ! -x "$stub" ]; then
mkdir -p "$dir" || exit 1
part=$stub.$$
blocks=$((len / 512)) rest=$((len % 512))
if ! dd if="$0" of="$part" bs=512 skip=$((off / 512)) count=$blocks 2>/dev/null; then
echo "$0: cannot write the $os loader stub to $part" >&2
exit 1
fi
if [ "$rest" -ne 0 ] && ! dd if="$0" bs=1 skip=$((off + blocks * 512)) count=$rest 2>/dev/null >>"$part"; then
echo "$0: cannot write the last $rest bytes of the $os loader stub to $part" >&2
exit 1
fi
chmod 755 "$part" && mv -f "$part" "$stub" || {
echo "$0: cannot put the $os loader stub in place, $part is left over" >&2
exit 1
}
fi
exec "$stub" "$0" "$@"
echo "$0: cannot run the loader stub $stub" >&2
exit 126
`;
}

/**
 * The whole header, `size` bytes, with e_lfanew at 0x3c and the body padded
 * out with one comment line.
 */
export function buildHeader(size: number, lfanew: number, n: ScriptNumbers): Buffer {
  const note = " one file for windows, linux and macos ";
  const head = Buffer.alloc(QUOTE_END + 2, 0x20);
  head.write(APE_MAGIC + "\n", 0, "latin1");
  head.write(note.slice(0, 0x3c - 9).padEnd(0x3c - 9, " "), 9, "latin1");
  head.writeUInt32LE(lfanew, 0x3c); // Windows reads it; to a shell it is text in a quote
  head.write("'\n", QUOTE_END, "latin1");
  const text = Buffer.concat([head, Buffer.from(scriptBody(n), "latin1")]);
  if (text.length > size) {
    throw new Error(`the shell header needs ${text.length} bytes, the room in front of the PE header is ${size}`);
  }
  // The padding is a comment, so that a reader that parses the whole header
  // still sees valid sh. Nothing after the exec above is ever reached.
  const pad = Buffer.alloc(size - text.length, 0x2d /* - */);
  if (pad.length >= 2) {
    pad[0] = 0x23; /* # */
    pad[pad.length - 1] = 0x0a;
  } else {
    pad.fill(0x0a);
  }
  return Buffer.concat([text, pad]);
}
