import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { BuildError } from "../error.ts";

export function fail(message: string): never {
  throw new BuildError(message);
}

export function readAt(fd: number, offset: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    const count = readSync(fd, buffer, done, length - done, offset + done);
    if (count === 0) fail("a file ended early");
    done += count;
  }
  return buffer;
}

export function fixedName(data: Buffer, offset: number): string {
  return data.toString("latin1", offset, offset + 16).replace(/\0.*$/, "");
}

export function stringAt(table: Buffer, offset: number): string {
  return table.toString("latin1", offset, table.indexOf(0, offset));
}

export function isBitcode(path: string): boolean {
  if (!existsSync(path)) return false;
  const fd = openSync(path, "r");
  const magic = fstatSync(fd).size >= 4 ? readAt(fd, 0, 4).readUInt32BE(0) : 0;
  closeSync(fd);
  return magic === 0x4243c0de || magic === 0xdec0170b;
}

export function isElfObject(path: string): boolean {
  if (!existsSync(path)) return false;
  const fd = openSync(path, "r");
  const head = fstatSync(fd).size >= 18 ? readAt(fd, 0, 18) : undefined;
  closeSync(fd);
  return head !== undefined && head.readUInt32BE(0) === 0x7f454c46 && head.readUInt16LE(16) === 1;
}
