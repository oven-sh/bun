// Packs CPython's Lib/, unchanged, and src/python/ into the file that BunPythonStdlib.S embeds. BunPythonStdlib.cpp reads it and has the layout.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { constants, zstdCompressSync } from "zlib";
import { writeIfNotChangedBinary } from "./helpers.ts";

const [cpython, own, output, time] = process.argv.slice(2);
if (!cpython || !own || !output || !time) {
  console.error("usage: pack-python-stdlib.ts <cpython checkout> <src/python> <output> <time>");
  process.exit(1);
}

const skippedAnywhere = new Set(["__pycache__", "test", "tests"]);
const skippedPaths = new Set([
  ...["idlelib", "tkinter", "turtledemo", "turtle.py"], // need Tk
  "profiling/sampling", // reads the memory of a CPython process
  "ensurepip/_bundled", // a wheel of pip
  "site-packages",
]);

const patchlevel = readFileSync(join(cpython, "Include", "patchlevel.h"), "utf8");
const versionPart = (name: string) => patchlevel.match(new RegExp(`#define\\s+${name}\\s+(\\d+)`))![1];
const prefix = `python/lib/python${versionPart("PY_MAJOR_VERSION")}.${versionPart("PY_MINOR_VERSION")}/`;

const files: { path: Buffer; contents: Buffer }[] = [];
function addDirectory(root: string, prefix: string, relative: string) {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (skippedAnywhere.has(entry.name) || skippedPaths.has(path)) continue;
    if (entry.isDirectory()) {
      addDirectory(root, prefix, path);
    } else if (entry.isFile() && !entry.name.endsWith(".pyc")) {
      files.push({ path: Buffer.from(prefix + path), contents: readFileSync(join(root, path)) });
    }
  }
}
addDirectory(join(cpython, "Lib"), prefix, "");
addDirectory(own, "python/lib/bun/", "");
// Where CPython's `make install` puts it, and `license()` looks for it.
files.push({ path: Buffer.from(prefix + "LICENSE.txt"), contents: readFileSync(join(cpython, "LICENSE")) });
files.sort((a, b) => Buffer.compare(a.path, b.path));

const headerSize = 24;
const entrySize = 20;
const stored = files.map(({ contents }) => {
  const compressed = zstdCompressSync(contents, { params: { [constants.ZSTD_c_compressionLevel]: 19 } });
  return compressed.length < contents.length ? compressed : contents;
});
const index = Buffer.alloc(headerSize + files.length * entrySize);
index.write("BUNPYLIB", 0, "latin1");
index.writeUInt32LE(1, 8);
index.writeUInt32LE(files.length, 12);
index.writeBigUInt64LE(BigInt(time), 16);
let pathOffset = index.length;
let dataOffset = pathOffset + files.reduce((sum, file) => sum + file.path.length, 0);
files.forEach((file, i) => {
  const at = headerSize + i * entrySize;
  index.writeUInt32LE(pathOffset, at);
  index.writeUInt32LE(file.path.length, at + 4);
  index.writeUInt32LE(dataOffset, at + 8);
  index.writeUInt32LE(stored[i].length, at + 12);
  index.writeUInt32LE(file.contents.length, at + 16);
  pathOffset += file.path.length;
  dataOffset += stored[i].length;
});
writeIfNotChangedBinary(output, Buffer.concat([index, ...files.map(file => file.path), ...stored]));
