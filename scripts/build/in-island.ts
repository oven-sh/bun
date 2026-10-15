/**
 * in-island.ts <island> <object> <output>
 *
 * What an assembler made has not been through LLVM, so feature-pass.cpp has not seen it. This gives its code and its constants
 * the names that the pass gives them, which is all that has them be in an island (src/bun_core/feature.rs). On COFF an
 * island has code only.
 */

import { readFileSync, writeFileSync } from "node:fs";

const [island, object, output] = process.argv.slice(2);
if (island === undefined || object === undefined || output === undefined)
  throw new Error("usage: <island> <object> <output>");

let file = readFileSync(object);
const text = (at: number, length: number) => file.toString("latin1", at, at + length).replace(/\0.*$/s, "");
let renamed = 0;

if (file.readUInt32BE(0) === 0x7f454c46) {
  // The names are in a section of their own, which the last field of the header says the number of. One with the new names too
  // goes at the end of the file.
  const names = new Map([
    [".text", `.bun_island_x.${island}`],
    [".rodata", `.bun_island_r.${island}`],
  ]);
  const [headers, size, count] = [Number(file.readBigUInt64LE(0x28)), file.readUInt16LE(0x3a), file.readUInt16LE(0x3c)];
  const strings = headers + file.readUInt16LE(0x3e) * size;
  const [start, length] = [Number(file.readBigUInt64LE(strings + 0x18)), Number(file.readBigUInt64LE(strings + 0x20))];
  const added: string[] = [];
  for (let header = headers; header < headers + count * size; header += size) {
    const name = names.get(text(start + file.readUInt32LE(header), 64));
    if (name === undefined) continue;
    file.writeUInt32LE(length + added.join("").length, header);
    added.push(name + "\0");
    renamed++;
  }
  file.writeBigUInt64LE(BigInt(file.length), strings + 0x18);
  file.writeBigUInt64LE(BigInt(length + added.join("").length), strings + 0x20);
  file = Buffer.concat([file, file.subarray(start, start + length), Buffer.from(added.join(""), "latin1")]);
} else if (file.readUInt32LE(0) === 0xfeedfacf) {
  const names = new Map([
    ["__TEXT,__text", `__bun_x${island}`],
    ["__TEXT,__const", `__bun_r${island}`],
  ]);
  let command = 32;
  for (let i = 0; i < file.readUInt32LE(16); i++, command += file.readUInt32LE(command + 4)) {
    if (file.readUInt32LE(command) !== 0x19 /* LC_SEGMENT_64 */) continue;
    for (let section = command + 72; section < command + 72 + file.readUInt32LE(command + 64) * 80; section += 80) {
      const name = names.get(`${text(section + 16, 16)},${text(section, 16)}`);
      if (name === undefined) continue;
      file.fill(0, section, section + 16);
      file.write(name, section, "latin1");
      renamed++;
    }
  }
} else {
  // A name of more than 8 characters is "/" and where it is among the strings, which are the last thing in the file and start
  // with their size.
  const name = `.text$bun${island}.m\0`;
  const strings = file.readUInt32LE(8) + file.readUInt32LE(12) * 18;
  const size = file.readUInt32LE(strings);
  if (strings + size !== file.length) throw new Error(`${object}: not a COFF object that ends with its strings`);
  const first = 20 + file.readUInt16LE(16);
  for (let section = first; section < first + file.readUInt16LE(2) * 40; section += 40) {
    if (text(section, 8) !== ".text") continue;
    file.fill(0, section, section + 8);
    file.write(`/${size}`, section, "latin1");
    renamed++;
  }
  file.writeUInt32LE(size + name.length, strings);
  file = Buffer.concat([file, Buffer.from(name, "latin1")]);
}

if (renamed === 0) throw new Error(`${object}: has no code`);
writeFileSync(output, file);
