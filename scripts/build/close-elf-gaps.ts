/**
 * close-elf-gaps.ts <file>
 *
 * llvm-strip removes a section's header but keeps its bytes in the segment. This drops the whole pages at the end of a
 * read-only PT_LOAD that no section covers and moves the rest of the file down. Addresses don't change.
 */
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const [loadable, noBits] = [1, 8];
const [programHeader, sectionHeader] = [
  { type: 0, flags: 4, offset: 8, fileSize: 32, memorySize: 40, alignment: 48 },
  { type: 4, offset: 24, size: 32 },
];
const mayWrite = 2;

const path = process.argv[2]!;
let file: Buffer = readFileSync(path);
if (file.readUInt32BE(0) !== 0x7f454c46 || file[4] !== 2 || file[5] !== 1)
  throw new Error(`${path} is not a little-endian ELF64 file`);

const word = (at: number) => Number(file.readBigUInt64LE(at));
const setWord = (at: number, value: number) => file.writeBigUInt64LE(BigInt(value), at);
const tableAt = (offsetAt: number, sizeAt: number, countAt: number) =>
  Array.from({ length: file.readUInt16LE(countAt) }, (_, index) => word(offsetAt) + index * file.readUInt16LE(sizeAt));

for (let index = 0; index < file.readUInt16LE(56); index++) {
  const programHeaders = tableAt(32, 54, 56);
  const sectionHeaders = tableAt(40, 58, 60);
  const segment = programHeaders[index]!;
  const [start, size] = [word(segment + programHeader.offset), word(segment + programHeader.fileSize)];
  if (
    file.readUInt32LE(segment + programHeader.type) !== loadable ||
    file.readUInt32LE(segment + programHeader.flags) & mayWrite
  )
    continue;
  if (size !== word(segment + programHeader.memorySize)) continue;

  const ranges = (
    [
      ...programHeaders
        .filter(header => header !== segment)
        .map(header => [word(header + programHeader.offset), word(header + programHeader.fileSize)]),
      ...sectionHeaders
        .filter(header => file.readUInt32LE(header + sectionHeader.type) !== noBits)
        .map(header => [word(header + sectionHeader.offset), word(header + sectionHeader.size)]),
      [word(32), programHeaders.length * file.readUInt16LE(54)],
      [word(40), sectionHeaders.length * file.readUInt16LE(58)],
    ] as [number, number][]
  ).filter(([, length]) => length > 0);
  const inside = ranges.filter(([offset]) => offset >= start && offset < start + size);
  if (inside.length === 0) continue;
  const used = Math.max(...inside.map(([offset, length]) => offset + length));
  const next = Math.min(file.length, ...ranges.map(([offset]) => offset).filter(offset => offset >= start + size));

  const pageSize = word(segment + programHeader.alignment);
  const [from, to] = [Math.ceil(used / pageSize) * pageSize, Math.floor(next / pageSize) * pageSize];
  if (used > start + size || to <= from) continue;

  setWord(segment + programHeader.fileSize, used - start);
  setWord(segment + programHeader.memorySize, used - start);
  for (const header of programHeaders)
    if (word(header + programHeader.offset) >= to)
      setWord(header + programHeader.offset, word(header + programHeader.offset) - (to - from));
  for (const header of sectionHeaders)
    if (word(header + sectionHeader.offset) >= to)
      setWord(header + sectionHeader.offset, word(header + sectionHeader.offset) - (to - from));
  for (const at of [32, 40]) if (word(at) >= to) setWord(at, word(at) - (to - from));
  file = Buffer.concat([file.subarray(0, from), file.subarray(to)]);
}

writeFileSync(path + ".tmp", file, { mode: statSync(path).mode });
renameSync(path + ".tmp", path);
