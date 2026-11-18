/**
 * ICU's common data package ("CmnD", format version 1), little-endian:
 *
 *   header       u16 size, 0xda 0x27, UDataInfo, a comment
 *   u32          number of items
 *   u32, u32     for each item, in the order of the names: offset of its name, offset of its data
 *   names        "<package>/<item>", each with a terminator
 *   data         each item on a 16-byte boundary
 *
 * Offsets count from the end of the header. An item has no length: it ends where the next one starts.
 */

import { assert } from "../error.ts";

export interface Item {
  /** Without the name of the package: "coll/de.res". */
  name: string;
  data: Buffer;
}

export interface Package {
  /** "icudt79l" */
  name: string;
  header: Buffer;
  items: Item[];
}

const ALIGNMENT = 16;
const PADDING = 0xaa;

const aligned = (offset: number): number => Math.ceil(offset / ALIGNMENT) * ALIGNMENT;

export function readPackage(file: Buffer): Package {
  assert(
    file.length >= 32 &&
      file.readUInt16BE(2) === 0xda27 &&
      file[8] === 0 &&
      file.toString("latin1", 12, 17) === "CmnD\x01",
    "not a little-endian ICU data package of format version 1",
  );
  const header = file.subarray(0, file.readUInt16LE(0));
  const contents = file.subarray(header.length);
  const count = contents.readUInt32LE(0);
  const dataOffset = (index: number) => (index < count ? contents.readUInt32LE(8 + 8 * index) : contents.length);

  const entries = Array.from({ length: count }, (_, index) => {
    const nameOffset = contents.readUInt32LE(4 + 8 * index);
    const [start, end] = [dataOffset(index), dataOffset(index + 1)];
    assert(start <= end && end <= contents.length, `item ${index} of the ICU data package lies outside it`);
    return {
      path: contents.toString("latin1", nameOffset, contents.indexOf(0, nameOffset)),
      data: contents.subarray(start, end),
    };
  });

  const name = entries[0]?.path.split("/")[0];
  assert(name !== undefined, "the ICU data package is empty");
  const items = entries.map(({ path, data }) => {
    assert(path.startsWith(`${name}/`), `${path} is not an item of the package ${name}`);
    return { name: path.slice(name.length + 1), data };
  });
  return { name, header, items };
}

export function writePackage({ name, header, items }: Package): Buffer {
  const paths = items.map(item => `${name}/${item.name}\0`);
  const namesStart = header.length + 4 + 8 * items.length;
  let end = paths.reduce((offset, path) => offset + path.length, namesStart);
  const dataStarts = items.map(({ data }) => {
    const start = aligned(end);
    end = start + data.length;
    return start;
  });

  const file = Buffer.alloc(end, PADDING);
  let entry = file.writeUInt32LE(items.length, header.copy(file));
  let nameStart = namesStart;
  items.forEach(({ data }, index) => {
    entry = file.writeUInt32LE(nameStart - header.length, entry);
    entry = file.writeUInt32LE(dataStarts[index]! - header.length, entry);
    nameStart += file.write(paths[index]!, nameStart, "latin1");
    data.copy(file, dataStarts[index]!);
  });
  return file;
}
