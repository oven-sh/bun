import { closeSync, fstatSync, openSync } from "node:fs";
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
