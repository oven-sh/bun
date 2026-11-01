/**
 * embed-compiled-library.ts <bun> [--from <other bun>] [--image <file>]
 *
 * Puts Bun's own JavaScript, compiled ahead of time, into the executable: the section `.bun_library`. `bun test --aot`
 * takes it for the lowest layer of a run that is built in layers, which otherwise compiles that code in every run.
 *
 * No segment holds the section, so the loader maps none of it and nothing but such a run reads it. It goes behind
 * everything else in the file, and no byte that is loaded moves. It is compressed: such a run unpacks it once.
 *
 * The program comes from `--image` (as a builder wrote it), or out of `--from` (the same link before it was stripped: a
 * compiled program goes by the build id, which strip keeps), or <bun> compiles it now.
 */
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { constants, zstdCompressSync } from "node:zlib";

const sectionName = ".bun_library";
const alignment = 16;
const sectionHeader = { name: 0, type: 4, offset: 24, size: 32, alignment: 48 };
const sectionHeaderSize = 64;
const programBits = 1;

function readElf(path: string): Buffer {
  const file = readFileSync(path);
  if (file.readUInt32BE(0) !== 0x7f454c46 || file[4] !== 2 || file[5] !== 1)
    throw new Error(`${path} is not a little-endian ELF64 file`);
  if (file.readUInt16LE(58) !== sectionHeaderSize) throw new Error(`${path} has section headers of an unknown size`);
  return file;
}

function sectionsOf(file: Buffer) {
  const word = (at: number) => Number(file.readBigUInt64LE(at));
  const headers = Array.from({ length: file.readUInt16LE(60) }, (_, index) => word(40) + index * sectionHeaderSize);
  const names = headers[file.readUInt16LE(62)]!;
  const [namesAt, namesSize] = [word(names + sectionHeader.offset), word(names + sectionHeader.size)];
  const nameOf = (header: number) => {
    const start = namesAt + file.readUInt32LE(header + sectionHeader.name);
    return file.toString("latin1", start, file.indexOf(0, start));
  };
  return { word, headers, names, namesAt, namesSize, nameOf };
}

function findImage(file: Buffer): Buffer | undefined {
  const { word, headers, nameOf } = sectionsOf(file);
  const header = headers.find(header => nameOf(header) === sectionName);
  if (header === undefined) return undefined;
  const offset = word(header + sectionHeader.offset);
  return file.subarray(offset, offset + word(header + sectionHeader.size));
}

/**
 * Two thirds of the program are zeros in one piece: the room for what the programs above it bring. They are left out.
 * How many bytes lie in front of them, how many they are, and the rest, compressed.
 */
function pack(program: Buffer): Buffer {
  const block = 4096;
  const zeroBlock = Buffer.alloc(block);
  let [longestAt, longest, at, length] = [0, 0, 0, 0];
  for (let offset = 0; offset + block <= program.length; offset += block) {
    if (program.compare(zeroBlock, 0, block, offset, offset + block) !== 0) {
      length = 0;
      continue;
    }
    if (length === 0) at = offset;
    length += block;
    if (length > longest) [longestAt, longest] = [at, length];
  }
  const sizes = Buffer.alloc(16);
  sizes.writeBigUInt64LE(BigInt(longestAt), 0);
  sizes.writeBigUInt64LE(BigInt(longest), 8);
  const rest = Buffer.concat([program.subarray(0, longestAt), program.subarray(longestAt + longest)]);
  return Buffer.concat([sizes, zstdCompressSync(rest, { params: { [constants.ZSTD_c_compressionLevel]: 19 } })]);
}

function compileLibrary(bun: string): Buffer {
  // An empty project: no package.json, bunfig.toml or tsconfig.json has a say. The program holds its path, so that is
  // the same in each build of a folder.
  const folder = resolve(bun) + ".compiled-library";
  rmSync(folder, { recursive: true, force: true });
  try {
    const project = join(folder, "project");
    mkdirSync(project, { recursive: true });
    const build = (name: string, words: string, ...descriptors: number[]) => {
      const image = join(folder, name);
      // Where a builder finds the paths of its test files, of which there are none, and leaves its program.
      const descriptor = openSync(image, "w+");
      const command = ["test", "--aot", `--aot-build-test-part=3,shared,library,${words}`];
      const { status, signal, error } = spawnSync(resolve(bun), command, {
        cwd: project,
        stdio: ["ignore", "inherit", "inherit", descriptor, ...descriptors],
        env: {
          HOME: folder,
          XDG_CONFIG_HOME: folder,
          TMPDIR: folder,
          BUN_TMPDIR: folder,
          BUN_DEBUG_QUIET_LOGS: "1",
          NO_COLOR: "1",
        },
      });
      closeSync(descriptor);
      if (status !== 0)
        throw new Error(
          `${bun} could not compile its own code (${error?.message ?? signal ?? `exit status ${status}`})`,
        );
      return image;
    };
    // The first build only tells the second which built-ins the library itself writes.
    const reference = openSync(build("reference", "reference-build"), "r");
    const image = build("image", "reference:4", reference);
    closeSync(reference);
    return pack(readFileSync(image));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const [path, ...options] = process.argv.slice(2);
if (path === undefined) throw new Error("usage: embed-compiled-library.ts <bun> [--from <other bun>] [--image <file>]");
const optionAfter = (flag: string) => (options.includes(flag) ? options[options.indexOf(flag) + 1] : undefined);
const [from, given] = [optionAfter("--from"), optionAfter("--image")];

const file = readElf(path);
if (findImage(file) !== undefined) {
  // Some strips keep a section that no segment holds.
  if (from === undefined) throw new Error(`${path} has a section ${sectionName} already`);
  process.exit(0);
}
const image =
  given !== undefined
    ? pack(readFileSync(given))
    : from !== undefined
      ? findImage(readElf(from))
      : compileLibrary(path);
if (image === undefined) throw new Error(`${from} has no section ${sectionName}`);

const { headers, names, namesAt, namesSize } = sectionsOf(file);
// Behind the image: the names of the sections with one more, and the section headers with one more. The old ones stay
// where they are, unused.
const imageAt = Math.ceil(file.length / alignment) * alignment;
const newNamesAt = imageAt + image.length;
const oldNames = file.subarray(namesAt, namesAt + namesSize);
const newNames = Buffer.concat([oldNames, Buffer.from(sectionName + "\0", "latin1")]);
const newHeadersAt = Math.ceil((newNamesAt + newNames.length) / 8) * 8;
const newHeaders = Buffer.alloc((headers.length + 1) * sectionHeaderSize);
file.copy(newHeaders, 0, headers[0]!, headers[0]! + headers.length * sectionHeaderSize);
const namesInNew = names - headers[0]!;
newHeaders.writeBigUInt64LE(BigInt(newNamesAt), namesInNew + sectionHeader.offset);
newHeaders.writeBigUInt64LE(BigInt(newNames.length), namesInNew + sectionHeader.size);
const added = headers.length * sectionHeaderSize;
newHeaders.writeUInt32LE(namesSize, added + sectionHeader.name);
newHeaders.writeUInt32LE(programBits, added + sectionHeader.type);
newHeaders.writeBigUInt64LE(BigInt(imageAt), added + sectionHeader.offset);
newHeaders.writeBigUInt64LE(BigInt(image.length), added + sectionHeader.size);
newHeaders.writeBigUInt64LE(BigInt(alignment), added + sectionHeader.alignment);

file.writeBigUInt64LE(BigInt(newHeadersAt), 40);
file.writeUInt16LE(headers.length + 1, 60);
writeFileSync(
  path + ".tmp",
  Buffer.concat([
    file,
    Buffer.alloc(imageAt - file.length),
    image,
    newNames,
    Buffer.alloc(newHeadersAt - newNamesAt - newNames.length),
    newHeaders,
  ]),
  { mode: statSync(path).mode },
);
renameSync(path + ".tmp", path);
console.log(`${sectionName}: ${image.length} bytes at ${imageAt} of ${path}`);
