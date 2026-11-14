import { closeSync, fstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BuildError } from "../error.ts";
import { readAt } from "./binary-reader.ts";

export interface ArchiveMember {
  archive: string;
  offset: number;
  size: number;
}

const unnamedMember = /^(|\/|\/SYM64\/?|\/<HYBRIDMAP>\/|\/<ECSYMBOLS>\/)$/;

function longName(table: Buffer, start: number): string {
  let stop = start;
  while (stop < table.length && table[stop] !== 0 && table[stop] !== 10) stop++;
  return table.toString("latin1", start, stop).replace(/\/$/, "");
}

export function readArchive(path: string): Map<string, ArchiveMember[]> {
  const members = new Map<string, ArchiveMember[]>();
  const fd = openSync(path, "r");
  try {
    const end = fstatSync(fd).size;
    if (end < 8 || readAt(fd, 0, 8).toString("latin1") !== "!<arch>\n") return members;
    let longNames: Buffer = Buffer.alloc(0);
    for (let at = 8; at + 60 <= end;) {
      const header = readAt(fd, at, 60).toString("latin1");
      const size = Number(header.slice(48, 58));
      if (!(at + 60 + size <= end)) {
        throw new BuildError("an archive member runs past the end of the file, or its size is not a number", {
          file: path,
        });
      }
      const field = header.slice(0, 16).trimEnd();
      if (field === "//") longNames = readAt(fd, at + 60, size);
      else if (!unnamedMember.test(field)) {
        let name: string;
        let nameLength = 0;
        if (/^\/\d+$/.test(field)) name = longName(longNames, Number(field.slice(1)));
        else if (/^#1\/\d+$/.test(field)) {
          nameLength = Number(field.slice(3));
          if (nameLength > size)
            throw new BuildError("the name of an archive member is longer than the member", { file: path });
          name = readAt(fd, at + 60, nameLength)
            .toString("latin1")
            .replace(/\0+$/, "");
        } else name = field.replace(/\/$/, "");
        const member = { archive: path, offset: at + 60 + nameLength, size: size - nameLength };
        const list = members.get(name);
        if (list === undefined) members.set(name, [member]);
        else list.push(member);
      }
      at += 60 + size + (size & 1);
    }
    return members;
  } finally {
    closeSync(fd);
  }
}

/** What the index of the archive offers: each name, and where the header of the member that defines it starts. */
export function readArchiveIndex(path: string): [name: string, header: number][] {
  const fd = openSync(path, "r");
  try {
    const end = fstatSync(fd).size;
    if (end < 68 || readAt(fd, 0, 8).toString("latin1") !== "!<arch>\n") return [];
    const header = readAt(fd, 8, 60).toString("latin1");
    const size = Number(header.slice(48, 58));
    if (header.slice(0, 16).trimEnd() !== "/" || !(size >= 4 && 68 + size <= end)) return [];
    const index = readAt(fd, 68, size);
    const count = index.readUInt32BE(0);
    const entries: [string, number][] = [];
    for (let number = 0, at = 4 + 4 * count; number < count && at < size; number++) {
      const stop = index.indexOf(0, at);
      entries.push([index.toString("latin1", at, stop), index.readUInt32BE(4 + 4 * number)]);
      at = stop + 1;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes `target`: the archive without the members that `isLeftOut` says of, by where their contents start, and an index that offers
 * what the others define. Returns `path` where no member is left out, and undefined where none is left.
 */
export function copyArchiveWithout(
  path: string,
  target: string,
  isLeftOut: (fd: number, contents: number, size: number) => boolean,
): string | undefined {
  const fd = openSync(path, "r");
  try {
    const end = fstatSync(fd).size;
    if (end < 8 || readAt(fd, 0, 8).toString("latin1") !== "!<arch>\n") return path;
    const kept: { header: number; bytes: number }[] = [];
    let longNames: { header: number; bytes: number } | undefined;
    let indexes = 0;
    let leftOut = 0;
    for (let at = 8; at + 60 <= end;) {
      const header = readAt(fd, at, 60).toString("latin1");
      const size = Number(header.slice(48, 58));
      if (!(at + 60 + size <= end)) {
        throw new BuildError("an archive member runs past the end of the file, or its size is not a number", {
          file: path,
        });
      }
      const field = header.slice(0, 16).trimEnd();
      const bytes = 60 + size + (size & 1);
      if (field === "//") longNames = { header: at, bytes };
      else if (field === "/") indexes++;
      else if (!unnamedMember.test(field)) {
        if (isLeftOut(fd, at + 60, size)) leftOut++;
        else kept.push({ header: at, bytes });
      }
      at += bytes;
    }
    if (leftOut === 0) return path;
    if (kept.length === 0) return undefined;
    const isKept = new Set(kept.map(member => member.header));
    const offered = readArchiveIndex(path).filter(([, header]) => isKept.has(header));
    const textOf = (list: [string, number][]) => Buffer.from(list.map(([name]) => name + "\0").join(""), "latin1");
    const names = textOf(offered);
    const padded = (size: number) => size + (size & 1);
    const indexSize = 4 + 4 * offered.length + names.length;
    // A second index is what tells a reader that the long names end as they do in an archive of Microsoft's kind.
    const sorted = indexes > 1 ? [...offered].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : [];
    const secondSize = indexes > 1 ? 4 + 4 * kept.length + 4 + 2 * sorted.length + names.length : 0;
    const newHeaderOf = new Map<number, number>();
    let at = 8 + 60 + padded(indexSize) + (indexes > 1 ? 60 + padded(secondSize) : 0) + (longNames?.bytes ?? 0);
    for (const member of kept) {
      newHeaderOf.set(member.header, at);
      at += member.bytes;
    }
    const index = Buffer.alloc(4 + 4 * offered.length);
    index.writeUInt32BE(offered.length, 0);
    offered.forEach(([, header], number) => index.writeUInt32BE(newHeaderOf.get(header)!, 4 + 4 * number));
    const headerOfIndex = (size: number) =>
      Buffer.from(
        "/".padEnd(16) +
          "0".padEnd(12) +
          "0".padEnd(6) +
          "0".padEnd(6) +
          "0".padEnd(8) +
          String(size).padEnd(10) +
          "`\n",
        "latin1",
      );
    const second = Buffer.alloc(indexes > 1 ? 4 + 4 * kept.length + 4 + 2 * sorted.length : 0);
    if (indexes > 1) {
      const numberOf = new Map(kept.map((member, number) => [member.header, number + 1]));
      second.writeUInt32LE(kept.length, 0);
      kept.forEach((member, number) => second.writeUInt32LE(newHeaderOf.get(member.header)!, 4 + 4 * number));
      second.writeUInt32LE(sorted.length, 4 + 4 * kept.length);
      sorted.forEach(([, header], number) =>
        second.writeUInt16LE(numberOf.get(header)!, 8 + 4 * kept.length + 2 * number),
      );
    }
    // A member at the end of the file may lack the byte that pads it to an even length.
    const bytesOf = (member: { header: number; bytes: number }) => {
      const bytes = Buffer.alloc(member.bytes, 10);
      readAt(fd, member.header, Math.min(member.bytes, end - member.header)).copy(bytes);
      return bytes;
    };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      Buffer.concat([
        Buffer.from("!<arch>\n", "latin1"),
        headerOfIndex(indexSize),
        index,
        names,
        Buffer.alloc(indexSize & 1, 10),
        ...(indexes > 1 ? [headerOfIndex(secondSize), second, textOf(sorted), Buffer.alloc(secondSize & 1, 10)] : []),
        ...(longNames === undefined ? [] : [bytesOf(longNames)]),
        ...kept.map(bytesOf),
      ]),
    );
    return target;
  } finally {
    closeSync(fd);
  }
}

export class ArchiveCache {
  readonly #archives = new Map<string, Map<string, ArchiveMember[]>>();

  members(archive: string): Map<string, ArchiveMember[]> {
    let members = this.#archives.get(archive);
    if (members === undefined) this.#archives.set(archive, (members = readArchive(archive)));
    return members;
  }
}

export function splitArchivePath(path: string): { archive: string; member: string } | undefined {
  const match = /^(.*)\(([^()]*)\)$/.exec(path);
  return match === null ? undefined : { archive: match[1]!, member: match[2]! };
}
