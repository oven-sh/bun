import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

export interface CoffGraph {
  address: number[];
  size: number[];
  alignment: number[];
  output: string[];
  object: string[];
  section: string[];
  successors: number[][];
  roots: Set<number>;
  functionName: Map<number, string>;
  names: string[][];
  aliases: Map<number, [string, string][]>;
  externalNames: Set<string>;
  unreadObjects: string[];
  confirmedByTheBytes: number;
  sentOn: number;
  boundElsewhere: string[];
  isArm64: boolean;
}

export interface CoffLink {
  executable: string;
  chunkMap: string;
  symbolMap: string;
  inputs: string[];
  libraryFolders: string[];
  objdump: string;
  work: string;
}

const isComdat = 0x1000;
const isNotLoaded = 0x200 | 0x800 | 0x0200_0000;
const associative = 5;
const external = 2;
const weakExternal = 105;
const mostUnexplainedCode = 1_000_000;
const isOrdinary = /^\.(text|rdata|data|bss|xdata|pdata)(\$|$)/;

const scalarDeleting = (name: string) => (name.startsWith("??_E") ? "??_G" + name.slice(4) : name);

function readAt(fd: number, offset: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    const count = readSync(fd, buffer, done, length - done, offset + done);
    if (count === 0) throw new Error("a file ended early");
    done += count;
  }
  return buffer;
}

interface Chunk {
  address: number;
  size: number;
  alignment: number;
  output: string;
  object: string;
  section: string;
}

function readChunks(path: string): Chunk[] {
  const text = readFileSync(path, "latin1");
  const chunks: Chunk[] = [];
  let output = "";
  for (let at = text.indexOf("\n") + 1; at < text.length;) {
    let end = text.indexOf("\n", at);
    if (end < 0) end = text.length;
    if (text.charCodeAt(at + 24) !== 32) output = text.slice(at + 24, end).trim();
    else if (text.charCodeAt(at + 32) !== 32 && output !== ".pdata") {
      const line = text.slice(at, end).trimEnd();
      const open = line.lastIndexOf(":(");
      const size = parseInt(line.slice(9, 17), 16);
      if (open > 0 && size > 0) {
        chunks.push({
          address: parseInt(line.slice(0, 8), 16),
          size,
          alignment: Number(line.slice(18, 23)),
          output,
          object: line.slice(32, open),
          section: line.slice(open + 2, -1),
        });
      }
    }
    at = end + 1;
  }
  return chunks.sort((a, b) => a.address - b.address);
}

interface MapSymbol {
  name: string;
  address: number;
  object: string;
  isStatic: boolean;
}

function readSymbols(path: string): { symbols: MapSymbol[]; entry: number } {
  const symbols: MapSymbol[] = [];
  const sectionStart = new Map<number, number>();
  let base = 0;
  let entry = -1;
  let isStatic = false;
  for (const line of readFileSync(path, "latin1").split("\n")) {
    const symbol = /^ ([0-9a-f]{4}):([0-9a-f]{8}) +(\S+) +([0-9a-f]{16}) +(.*?)\s*$/.exec(line);
    if (symbol !== null) {
      if (symbol[1] === "0000") continue;
      const address = parseInt(symbol[4]!, 16) - base;
      sectionStart.set(parseInt(symbol[1]!, 16), address - parseInt(symbol[2]!, 16));
      symbols.push({ name: symbol[3]!, address, object: symbol[5]!, isStatic });
    } else if (line.startsWith(" Preferred load address is ")) base = parseInt(line.slice(27), 16);
    else if (line.startsWith(" Static symbols")) isStatic = true;
    else {
      const at = /^ entry point at +([0-9a-f]{4}):([0-9a-f]{8})/.exec(line);
      if (at !== null) entry = (sectionStart.get(parseInt(at[1]!, 16)) ?? NaN) + parseInt(at[2]!, 16);
    }
  }
  return { symbols, entry };
}

interface Member {
  archive: string;
  offset: number;
  size: number;
}

function readArchive(path: string, members: Map<string, Member[]>): void {
  const fd = openSync(path, "r");
  const end = fstatSync(fd).size;
  if (end >= 8 && readAt(fd, 0, 8).toString("latin1") === "!<arch>\n") {
    let longNames: Buffer = Buffer.alloc(0);
    for (let at = 8; at + 60 <= end;) {
      const header = readAt(fd, at, 60).toString("latin1");
      const size = Number(header.slice(48, 58));
      let name = header.slice(0, 16).trimEnd();
      if (name === "//") longNames = readAt(fd, at + 60, size);
      else if (name !== "/" && name !== "/<HYBRIDMAP>/" && name !== "/<ECSYMBOLS>/") {
        if (/^\/\d+$/.test(name)) {
          const start = Number(name.slice(1));
          let stop = start;
          while (stop < longNames.length && longNames[stop] !== 0 && longNames[stop] !== 10) stop++;
          name = longNames.toString("latin1", start, stop);
        }
        name = name.replace(/\/$/, "");
        const list = members.get(name);
        const member = { archive: path, offset: at + 60, size };
        if (list === undefined) members.set(name, [member]);
        else list.push(member);
      }
      at += 60 + size + (size & 1);
    }
  }
  closeSync(fd);
}

interface Section {
  name: string;
  size: number;
  contents: number;
  flags: number;
  relocations: number;
  relocationCount: number;
  selection: number;
  parent: number;
  leader: number;
}

class CoffObject {
  sections: Section[] = [];
  symbolSection: Int32Array;
  symbolValue: Uint32Array;
  symbolClass: Uint8Array;
  symbolDefault: Int32Array;
  byName = new Map<string, number[]>();
  private fd: number;
  private base: number;
  private symbols: Buffer;
  private strings: Buffer;
  private entry: number;

  private constructor(fd: number, base: number, header: Buffer) {
    this.fd = fd;
    this.base = base;
    const isBig = header.readUInt16LE(0) === 0 && header.readUInt16LE(2) === 0xffff;
    const sectionCount = isBig ? header.readUInt32LE(44) : header.readUInt16LE(2);
    const symbolsAt = header.readUInt32LE(isBig ? 48 : 8);
    const symbolCount = header.readUInt32LE(isBig ? 52 : 12);
    this.entry = isBig ? 20 : 18;
    this.symbols = readAt(fd, base + symbolsAt, symbolCount * this.entry);
    const stringsAt = base + symbolsAt + symbolCount * this.entry;
    this.strings = symbolsAt === 0 ? Buffer.alloc(4) : readAt(fd, stringsAt, readAt(fd, stringsAt, 4).readUInt32LE(0));
    const table = readAt(fd, base + (isBig ? 56 : 20 + header.readUInt16LE(16)), sectionCount * 40);
    for (let at = 0; at < table.length; at += 40) {
      let name = table.toString("latin1", at, at + 8).replace(/\0.*$/, "");
      if (/^\/\d+$/.test(name)) name = this.stringAt(Number(name.slice(1)));
      const flags = table.readUInt32LE(at + 36);
      let relocations = table.readUInt32LE(at + 24);
      let relocationCount = table.readUInt16LE(at + 32);
      if (relocationCount === 0xffff && flags & 0x0100_0000) {
        relocationCount = readAt(fd, base + relocations, 4).readUInt32LE(0) - 1;
        relocations += 10;
      }
      this.sections.push({
        name,
        size: table.readUInt32LE(at + 16),
        contents: table.readUInt32LE(at + 20),
        flags,
        relocations,
        relocationCount,
        selection: 0,
        parent: 0,
        leader: -1,
      });
    }
    this.symbolSection = new Int32Array(symbolCount);
    this.symbolValue = new Uint32Array(symbolCount);
    this.symbolClass = new Uint8Array(symbolCount);
    this.symbolDefault = new Int32Array(symbolCount).fill(-1);
    const defined = new Set<number>();
    for (let index = 0; index < symbolCount; index++) {
      const at = index * this.entry;
      const section = isBig ? this.symbols.readInt32LE(at + 12) : this.symbols.readInt16LE(at + 12);
      const storage = this.symbols[at + this.entry - 2]!;
      const auxiliaries = this.symbols[at + this.entry - 1]!;
      this.symbolSection[index] = section;
      this.symbolValue[index] = this.symbols.readUInt32LE(at + 8);
      this.symbolClass[index] = storage;
      if (storage === weakExternal && auxiliaries > 0)
        this.symbolDefault[index] = this.symbols.readUInt32LE(at + this.entry);
      if (section > 0 && section <= sectionCount) {
        const found = this.sections[section - 1]!;
        const isDefinition =
          storage === 3 &&
          auxiliaries > 0 &&
          this.symbolValue[index] === 0 &&
          !defined.has(section) &&
          this.nameOf(index) === found.name;
        if (isDefinition) {
          defined.add(section);
          const auxiliary = at + this.entry;
          found.selection = this.symbols[auxiliary + 14]!;
          found.parent =
            this.symbols.readUInt16LE(auxiliary + 12) | (isBig ? this.symbols.readUInt16LE(auxiliary + 16) << 16 : 0);
        } else {
          if (found.leader < 0 && found.flags & isComdat && found.selection !== associative) found.leader = index;
          const name = this.nameOf(index);
          const list = this.byName.get(name);
          if (list === undefined) this.byName.set(name, [index]);
          else list.push(index);
        }
      }
      index += auxiliaries;
    }
  }

  static open(fd: number, base: number, size: number): CoffObject | undefined {
    if (size < 56) return undefined;
    const header = readAt(fd, base, 56);
    const machine = header.readUInt16LE(0);
    if (machine === 0 && header.readUInt16LE(2) === 0xffff) {
      if (header.readUInt16LE(4) < 2) return undefined;
    } else if (machine !== 0x8664 && machine !== 0xaa64) return undefined;
    return new CoffObject(fd, base, header);
  }

  private stringAt(offset: number): string {
    return this.strings.toString("latin1", offset, this.strings.indexOf(0, offset));
  }

  nameOf(symbol: number): string {
    const at = symbol * this.entry;
    if (this.symbols.readUInt32LE(at) === 0) return this.stringAt(this.symbols.readUInt32LE(at + 4));
    return this.symbols.toString("latin1", at, at + 8).replace(/\0.*$/, "");
  }

  isFunction(symbol: number): boolean {
    return this.symbols.readUInt16LE(symbol * this.entry + this.entry - 4) === 0x20;
  }

  contentsOf(section: Section): string {
    return (
      `${section.name}\0${section.relocationCount}\0` +
      readAt(this.fd, this.base + section.contents, section.size).toString("latin1")
    );
  }

  bytesOf(section: Section): Buffer {
    return readAt(this.fd, this.base + section.contents, section.size);
  }

  relocationsOf(section: Section): Buffer {
    return readAt(this.fd, this.base + section.relocations, section.relocationCount * 10);
  }

  targetsOf(section: Section): Set<number> {
    const targets = new Set<number>();
    if (section.relocationCount === 0) return targets;
    const table = readAt(this.fd, this.base + section.relocations, section.relocationCount * 10);
    for (let at = 0; at < table.length; at += 10) targets.add(table.readUInt32LE(at + 4));
    return targets;
  }
}

interface Image {
  isArm64: boolean;
  base: number;
  at(address: number, length: number): [Buffer, number] | undefined;
}

function imageOf(executable: string): Image {
  const fd = openSync(executable, "r");
  const pe = readAt(fd, 0x3c, 4).readUInt32LE(0);
  const header = readAt(fd, pe, 24 + 32);
  const sections = readAt(fd, pe + 24 + header.readUInt16LE(20), header.readUInt16LE(6) * 40);
  const parts: { start: number; data: Buffer }[] = [];
  for (let at = 0; at < sections.length; at += 40) {
    const length = Math.min(sections.readUInt32LE(at + 8), sections.readUInt32LE(at + 16));
    if (length > 0)
      parts.push({ start: sections.readUInt32LE(at + 12), data: readAt(fd, sections.readUInt32LE(at + 20), length) });
  }
  closeSync(fd);
  let last = parts[0];
  return {
    isArm64: header.readUInt16LE(4) === 0xaa64,
    base: header.readUInt32LE(24 + 24) + header.readUInt32LE(24 + 28) * 0x100000000,
    at(address, length) {
      const holds = (part: { start: number; data: Buffer }) =>
        part.start <= address && address + length <= part.start + part.data.length;
      if (last === undefined || !holds(last)) last = parts.find(holds);
      return last && [last.data, address - last.start];
    },
  };
}

type AddressGiven = (type: number, place: number, before: Buffer, offset: number, symbol: number) => number | undefined;

function unsigned64(data: Buffer, at: number): number {
  return data.readUInt32LE(at) + data.readUInt32LE(at + 4) * 0x100000000;
}

function addressGivenOnX64(image: Image): AddressGiven {
  return (type, place, before, offset) => {
    const length = type === 1 ? 8 : 4;
    const written = offset + length <= before.length ? image.at(place, length) : undefined;
    if (written === undefined) return undefined;
    const [after, at] = written;
    if (type === 1) return unsigned64(after, at) - image.base - unsigned64(before, offset);
    if (type === 3) return after.readUInt32LE(at) - before.readUInt32LE(offset);
    if (type >= 4 && type <= 9) return after.readInt32LE(at) - before.readInt32LE(offset) + place + type;
    return undefined;
  };
}

function addressGivenOnArm64(image: Image): AddressGiven {
  const pages = new Map<number, [number, number]>();
  const signed = (value: number, bits: number) => (value >= 2 ** (bits - 1) ? value - 2 ** bits : value);
  const distance21 = (word: number) => (((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3);
  return (type, place, before, offset, symbol) => {
    const length = type === 14 ? 8 : 4;
    const written = offset + length <= before.length ? image.at(place, length) : undefined;
    if (written === undefined) return undefined;
    const [after, at] = written;
    if (type === 14) return unsigned64(after, at) - image.base - unsigned64(before, offset);
    if (type === 2) return after.readUInt32LE(at) - before.readUInt32LE(offset);
    if (type === 17) return after.readInt32LE(at) - before.readInt32LE(offset) + place + 4;
    const word = after.readUInt32LE(at);
    const old = before.readUInt32LE(offset);
    if (type === 3) return place + (signed(word & 0x3ffffff, 26) - signed(old & 0x3ffffff, 26)) * 4;
    if (type === 4) {
      pages.set(symbol, [place - (place % 4096) + signed(distance21(word), 21) * 4096, distance21(old)]);
      return undefined;
    }
    const page = pages.get(symbol);
    if (page === undefined || (type !== 6 && type !== 7)) return undefined;
    const scale = type === 6 ? 0 : (word >>> 30) + ((word & 0x04800000) >>> 0 === 0x04800000 ? 4 : 0);
    if (((old >>> 10) & 0xfff) * 2 ** scale !== page[1]) return undefined;
    return page[0] + ((word >>> 10) & 0xfff) * 2 ** scale - page[1];
  };
}

export function namedBytesOfPe(
  executable: string,
  symbolMap: string,
): { symbols: [string, number][]; between(start: number, end: number): Buffer | undefined } {
  const image = imageOf(executable);
  return {
    symbols: readSymbols(symbolMap).symbols.map(symbol => [symbol.name, symbol.address]),
    between(start, end) {
      const found = image.at(start, end - start);
      return found && found[0].subarray(found[1], found[1] + end - start);
    },
  };
}

function exportedAddresses(executable: string): number[] {
  const fd = openSync(executable, "r");
  const pe = readAt(fd, 0x3c, 4).readUInt32LE(0);
  const header = readAt(fd, pe, 24 + 240);
  const sections = readAt(fd, pe + 24 + header.readUInt16LE(20), header.readUInt16LE(6) * 40);
  const offsetOf = (address: number) => {
    for (let at = 0; at < sections.length; at += 40) {
      const start = sections.readUInt32LE(at + 12);
      if (address >= start && address - start < sections.readUInt32LE(at + 16))
        return sections.readUInt32LE(at + 20) + address - start;
    }
    return -1;
  };
  const directory = offsetOf(header.readUInt32LE(24 + 112));
  const addresses: number[] = [];
  if (directory >= 0) {
    const exports = readAt(fd, directory, 40);
    const functions = readAt(fd, offsetOf(exports.readUInt32LE(28)), exports.readUInt32LE(20) * 4);
    for (let at = 0; at < functions.length; at += 4) addresses.push(functions.readUInt32LE(at));
  }
  closeSync(fd);
  return addresses;
}

export function sectionInFile(executable: string, name: string): { offset: number; size: number } | undefined {
  const fd = openSync(executable, "r");
  const pe = readAt(fd, 0x3c, 4).readUInt32LE(0);
  const header = readAt(fd, pe, 24);
  const sections = readAt(fd, pe + 24 + header.readUInt16LE(20), header.readUInt16LE(6) * 40);
  closeSync(fd);
  for (let at = 0; at < sections.length; at += 40) {
    if (sections.toString("latin1", at, at + 8).replace(/\0.*$/, "") === name)
      return { offset: sections.readUInt32LE(at + 20), size: sections.readUInt32LE(at + 16) };
  }
  return undefined;
}

function inFull(objdump: string, work: string, mangled: string[]): string[] {
  const strings = Buffer.from(mangled.join("\0") + "\0", "latin1");
  const object = Buffer.alloc(20 + mangled.length * 18 + 4 + strings.length);
  object.writeUInt16LE(0x8664, 0);
  object.writeUInt32LE(20, 8);
  object.writeUInt32LE(mangled.length, 12);
  let offset = 4;
  mangled.forEach((name, index) => {
    const at = 20 + index * 18;
    object.writeUInt32LE(offset, at + 4);
    object.writeUInt16LE(0x20, at + 14);
    object[at + 16] = 2;
    offset += name.length + 1;
  });
  object.writeUInt32LE(4 + strings.length, 20 + mangled.length * 18);
  strings.copy(object, 20 + mangled.length * 18 + 4);
  const path = join(work, "names.obj");
  writeFileSync(path, object);
  const ran = spawnSync(objdump, ["-t", "-C", path], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (ran.error !== undefined || ran.status !== 0) throw new Error(`${objdump} failed`);
  const spelled = new Map<string, string>();
  for (const line of ran.stdout.split("\n")) {
    const found = /^\[ *\d+\]\(sec .*?\) 0x[0-9a-f]{8} (\S+) \((.*)\)$/.exec(line);
    if (found !== null && found[2] !== "invalid mangled name") spelled.set(found[1]!, found[2]!);
  }
  return mangled.map(name => spelled.get(name) ?? name);
}

const convention = /^__(cdecl|stdcall|fastcall|thiscall|vectorcall|clrcall|pascal|regcall|eabi|swift_1|swift_2)\b ?/;

function plainly(full: string, withReturnType: boolean): string {
  let at = full.startsWith("[thunk]: ") ? 9 : 0;
  let text = full.slice(0, at);
  at += /^(public|protected|private): /.exec(full.slice(at, at + 11))?.[0].length ?? 0;
  for (let word; (word = /^(static|virtual|extern "C") /.exec(full.slice(at, at + 11))) !== null;) at += word[0].length;
  const starts = [text.length];
  let returnsPointerToFunction = false;
  while (at < full.length) {
    const character = full[at]!;
    if (character === "`") {
      const from = at;
      for (let depth = 0; at < full.length; at++) {
        if (full[at] === "`" || (full[at] === "'" && full.startsWith(" for ", at - 5))) depth++;
        else if (full[at] === "'" && --depth === 0) break;
      }
      text += full.slice(from, ++at);
      continue;
    }
    const called = character === "_" && full[at - 1] !== "(" ? convention.exec(full.slice(at, at + 14)) : null;
    if (called !== null) {
      if (starts.length === 2 && convention.test(text.slice(starts[1])))
        returnsPointerToFunction = !withReturnType && starts.pop() !== undefined;
      if (!withReturnType) text = text.slice(0, starts.at(-1)! + (text[starts.at(-1)!] === "&" ? 1 : 0));
      at += called[0].length;
      continue;
    }
    if (returnsPointerToFunction && character === ")" && starts.length === 1) return text;
    text += character;
    at++;
    if (character === "<" || character === "(") starts.push(text.length);
    else if ((character === ">" || character === ")") && starts.length > 1) starts.pop();
    else if (character === "," && full[at] === " ") {
      text += " ";
      at++;
      starts[starts.length - 1] = text.length;
    }
  }
  return text;
}

function spelledAsElsewhere(objdump: string, work: string, names: string[]): string[] {
  const mangled = names.filter(name => name.startsWith("?"));
  if (mangled.length === 0) return names;
  const full = inFull(objdump, work, mangled);
  const withReturnType = full.map(text => plainly(text, true));
  const plain = full.map(text => plainly(text, false));
  const spelled = new Map<string, string>();
  mangled.forEach((name, index) => {
    let text = plain[index]!;
    let depth = 0;
    let parameters = -1;
    for (let at = 0; at < text.length && parameters < 0; at++) {
      if (text[at] === "<") depth++;
      else if (text[at] === ">") depth--;
      else if (text[at] === "(" && depth === 0 && !text.startsWith("(anonymous", at)) parameters = at;
    }
    if (parameters > 0 && text[parameters - 1] === ">") text = withReturnType[index]!;
    spelled.set(name, text.replaceAll("`anonymous namespace'", "(anonymous namespace)").replaceAll("(void)", "()"));
  });
  return names.map(name => spelled.get(name) ?? name);
}

export function readCoffGraph(link: CoffLink): CoffGraph {
  const chunks = readChunks(link.chunkMap);
  const { symbols, entry } = readSymbols(link.symbolMap);
  const count = chunks.length;
  const graph: CoffGraph = {
    address: chunks.map(chunk => chunk.address),
    size: chunks.map(chunk => chunk.size),
    alignment: chunks.map(chunk => chunk.alignment),
    output: chunks.map(chunk => chunk.output),
    object: chunks.map(chunk => chunk.object),
    section: chunks.map(chunk => chunk.section),
    successors: [],
    roots: new Set(),
    functionName: new Map(),
    names: chunks.map(() => []),
    aliases: new Map(),
    externalNames: new Set(),
    unreadObjects: [],
    confirmedByTheBytes: 0,
    sentOn: 0,
    boundElsewhere: [],
    isArm64: false,
  };
  const nodeAt = (address: number) => {
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (graph.address[middle]! <= address) low = middle + 1;
      else high = middle;
    }
    return low > 0 && address < graph.address[low - 1]! + graph.size[low - 1]! ? low - 1 : -1;
  };

  const members = new Map<string, Member[]>();
  const archives = new Set(link.inputs.filter(path => /\.(lib|rlib|a)$/i.test(path) && existsSync(path)));
  const stems = new Set(
    [...archives].map(path =>
      basename(path)
        .replace(/\.[^.]*$/, "")
        .toLowerCase(),
    ),
  );
  const wanted = new Set<string>();
  for (const symbol of symbols) {
    const colon = symbol.object.indexOf(":");
    if (colon > 1 && !stems.has(symbol.object.slice(0, colon).toLowerCase()))
      wanted.add(symbol.object.slice(0, colon).toLowerCase() + ".lib");
  }
  for (const folder of link.libraryFolders) {
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder)) {
      if (wanted.delete(file.toLowerCase())) archives.add(join(folder, file));
    }
  }
  for (const archive of archives) readArchive(archive, members);

  const files = new Map<string, number>();
  const fdOf = (path: string) => {
    let fd = files.get(path);
    if (fd === undefined) files.set(path, (fd = openSync(path, "r")));
    return fd;
  };
  const objects = new Map<string, CoffObject | undefined>();
  const nameInSymbolMap = new Map<string, string>();
  for (const { object } of chunks) {
    if (objects.has(object)) continue;
    let read: CoffObject | undefined;
    const inArchives = members.get(object);
    if (existsSync(object)) {
      const fd = fdOf(object);
      read = CoffObject.open(fd, 0, fstatSync(fd).size);
      nameInSymbolMap.set(object, basename(object).toLowerCase());
    } else if (inArchives?.length === 1) {
      const { archive, offset, size } = inArchives[0]!;
      read = CoffObject.open(fdOf(archive), offset, size);
      nameInSymbolMap.set(object, (basename(archive).replace(/\.[^.]*$/, "") + ":" + basename(object)).toLowerCase());
    }
    objects.set(object, read);
    if (read === undefined) graph.unreadObjects.push(object);
  }

  const placed = new Map<CoffObject, Map<number, number>>();
  const placeOf = (object: CoffObject) => {
    let places = placed.get(object);
    if (places === undefined) placed.set(object, (places = new Map()));
    return places;
  };
  const externalNode = new Map<string, number>();
  const staticNodes = new Map<string, number[]>();
  const leaderOf = new Map<number, string>();
  const ledByLabel = new Set<number>();
  for (const symbol of symbols) {
    const node = nodeAt(symbol.address);
    if (node < 0) continue;
    if (symbol.isStatic) {
      const key = symbol.object.toLowerCase() + "\0" + symbol.name;
      const list = staticNodes.get(key);
      if (list === undefined) staticNodes.set(key, [node]);
      else list.push(node);
    } else {
      externalNode.set(symbol.name, node);
      graph.externalNames.add(symbol.name);
    }
    const object = objects.get(graph.object[node]!);
    const isHere = nameInSymbolMap.get(graph.object[node]!) === symbol.object.toLowerCase();
    const own = isHere
      ? object?.byName.get(symbol.name)?.find(index => {
          const section = object.sections[object.symbolSection[index]! - 1]!;
          return (
            symbol.address - object.symbolValue[index]! === graph.address[node] &&
            section.size === graph.size[node] &&
            (object.symbolClass[index] === external) !== symbol.isStatic
          );
        })
      : undefined;
    if (object !== undefined && own !== undefined) placeOf(object).set(object.symbolSection[own]!, node);
    if (symbol.address !== graph.address[node]) continue;
    graph.names[node]!.push(symbol.name);
    const isLabel = object !== undefined && own !== undefined && symbol.isStatic && !object.isFunction(own);
    if (own !== undefined && (!leaderOf.has(node) || (ledByLabel.has(node) && !isLabel))) {
      leaderOf.set(node, symbol.name);
      if (isLabel) ledByLabel.add(node);
      else ledByLabel.delete(node);
    } else if (graph.output[node] === ".text" && !isLabel) {
      const aliases = graph.aliases.get(node);
      if (aliases === undefined) graph.aliases.set(node, [[symbol.object, "_" + symbol.name]]);
      else aliases.push([symbol.object, "_" + symbol.name]);
    }
  }

  const successors: Set<number>[] = chunks.map(() => new Set());
  const unplaced = new Map<CoffObject, Map<number, number>>();
  const waiting: [CoffObject, string, number, number][] = [];
  const unresolved = new Map<string, number>();
  const withoutAddress = (object: CoffObject, name: string, section: number) => {
    let nodes = unplaced.get(object);
    if (nodes === undefined) unplaced.set(object, (nodes = new Map()));
    let node = nodes.get(section);
    if (node === undefined) {
      nodes.set(section, (node = graph.address.length));
      graph.address.push(-1);
      graph.size.push(0);
      graph.alignment.push(1);
      graph.output.push("");
      graph.object.push(name);
      graph.section.push(object.sections[section - 1]!.name);
      graph.names.push([]);
      successors.push(new Set());
      waiting.push([object, name, section, node]);
    }
    return node;
  };
  const nodesOf = (object: CoffObject, name: string, section: number): number[] => {
    const node = placed.get(object)?.get(section);
    if (node !== undefined) return [node];
    const { leader } = object.sections[section - 1]!;
    if (leader >= 0) {
      const elsewhere =
        object.symbolClass[leader] === external
          ? externalNode.get(object.nameOf(leader))
          : staticNodes.get(nameInSymbolMap.get(name) + "\0" + object.nameOf(leader));
      if (elsewhere !== undefined) return typeof elsewhere === "number" ? [elsewhere] : elsewhere;
    }
    return [withoutAddress(object, name, section)];
  };
  const refer = (object: CoffObject, name: string, section: number, from: number) => {
    for (let symbol of object.targetsOf(object.sections[section - 1]!)) {
      for (;;) {
        const target = object.symbolSection[symbol]!;
        if (target > 0) {
          for (const node of nodesOf(object, name, target)) successors[from]!.add(node);
        } else if (target === 0) {
          const wanted = object.nameOf(symbol);
          const node = externalNode.get(wanted) ?? externalNode.get(scalarDeleting(wanted));
          if (node !== undefined) successors[from]!.add(node);
          else if (object.symbolDefault[symbol]! >= 0) {
            symbol = object.symbolDefault[symbol]!;
            continue;
          } else unresolved.set(object.nameOf(symbol), (unresolved.get(object.nameOf(symbol)) ?? 0) + 1);
        }
        break;
      }
    }
  };
  for (const [name, object] of objects) {
    if (object === undefined) continue;
    object.sections.forEach((section, index) => {
      if (section.flags & isNotLoaded || section.size === 0) return;
      const node = placed.get(object)?.get(index + 1);
      const parent = section.selection === associative ? placed.get(object)?.get(section.parent) : undefined;
      const isInTheImage = node !== undefined || parent !== undefined;
      if (!(section.flags & isComdat) || (isInTheImage && !isOrdinary.test(section.name)))
        graph.roots.add(node ?? withoutAddress(object, name, index + 1));
      if (node !== undefined) refer(object, name, index + 1, node);
      if (parent !== undefined) successors[parent]!.add(node ?? withoutAddress(object, name, index + 1));
    });
  }
  const isPlaced = new Set<number>();
  for (const places of placed.values()) for (const node of places.values()) isPlaced.add(node);
  const withoutPlace = new Map<string, Set<string>>();
  for (let node = 0; node < count; node++) {
    if (isPlaced.has(node) || objects.get(graph.object[node]!) === undefined) continue;
    let kinds = withoutPlace.get(graph.object[node]!);
    if (kinds === undefined) withoutPlace.set(graph.object[node]!, (kinds = new Set()));
    kinds.add(graph.section[node] + "\0" + graph.size[node]);
  }
  for (const [name, kinds] of withoutPlace) {
    const object = objects.get(name)!;
    object.sections.forEach((section, index) => {
      const couldBeOne =
        section.selection !== associative &&
        kinds.has(section.name + "\0" + section.size) &&
        !placed.get(object)?.has(index + 1);
      if (couldBeOne) graph.roots.add(withoutAddress(object, name, index + 1));
    });
  }
  for (let next = waiting.pop(); next !== undefined; next = waiting.pop()) refer(next[0], next[1], next[2], next[3]);
  const image = imageOf(link.executable);
  graph.isArm64 = image.isArm64;
  const onlyInTheBytes: [number, number][] = [];
  for (const [object, places] of placed) {
    for (const [index, from] of places) {
      const section = object.sections[index - 1]!;
      if (section.relocationCount === 0 || section.contents === 0) continue;
      const addressGiven = image.isArm64 ? addressGivenOnArm64(image) : addressGivenOnX64(image);
      const before = object.bytesOf(section);
      const table = object.relocationsOf(section);
      const given = new Map<number, number>();
      for (let at = 0; at < table.length; at += 10) {
        const symbol = table.readUInt32LE(at + 4);
        if (given.has(symbol) || object.symbolSection[symbol]! < 0) continue;
        const offset = table.readUInt32LE(at);
        const address = addressGiven(table.readUInt16LE(at + 8), graph.address[from]! + offset, before, offset, symbol);
        if (address !== undefined) given.set(symbol, address);
      }
      const isKnown = (node: number) => node >= 0 && (node === from || successors[from]!.has(node));
      for (const [symbol, address] of given) {
        const node = nodeAt(address);
        if (node < 0) continue;
        const withoutPlace = unplaced.get(object)?.get(object.symbolSection[symbol]!);
        if (withoutPlace !== undefined) onlyInTheBytes.push([withoutPlace, node], [from, node]);
        if (withoutPlace !== undefined || isKnown(node) || isKnown(nodeAt(address - 1))) {
          graph.confirmedByTheBytes++;
          continue;
        }
        onlyInTheBytes.push([from, node]);
        graph.boundElsewhere.push(
          `${graph.object[from]}:(${section.name}) names ${object.nameOf(symbol)}, which lies in ${graph.object[node]}:(${graph.section[node]})`,
        );
      }
    }
  }
  const foldable = (section: Section) => section.name.startsWith(".rdata") && section.contents !== 0;
  const named = (node: number) => [...successors[node]!].filter(next => next < count);
  const withoutName = new Map<string, [number, number[]][]>();
  const sizes = new Set<number>();
  for (const [object, nodes] of unplaced) {
    for (const [index, node] of nodes) {
      const section = object.sections[index - 1]!;
      if (!foldable(section)) continue;
      sizes.add(section.size);
      const contents = object.contentsOf(section);
      const list = withoutName.get(contents);
      if (list === undefined) withoutName.set(contents, [[node, named(node)]]);
      else list.push([node, named(node)]);
    }
  }
  for (const [object, places] of placed) {
    for (const [index, node] of places) {
      const section = object.sections[index - 1]!;
      if (!sizes.has(section.size) || !foldable(section)) continue;
      for (const [twin, names] of withoutName.get(object.contentsOf(section)) ?? []) {
        if (names.length === named(node).length && names.every(next => successors[node]!.has(next)))
          successors[twin]!.add(node);
      }
    }
  }
  for (const [from, node] of onlyInTheBytes) successors[from]!.add(node);
  for (const fd of files.values()) closeSync(fd);

  graph.successors = successors.map((set, node) => (set.delete(node), [...set]));
  for (let node = 0; node < count; node++) {
    if (objects.get(graph.object[node]!) !== undefined) continue;
    if (graph.output[node] !== ".rsrc")
      throw new Error(`${graph.object[node]}, an input of the link, could not be read`);
    graph.roots.add(node);
  }
  for (const address of [entry, ...exportedAddresses(link.executable)]) {
    const node = nodeAt(address);
    if (node >= 0) graph.roots.add(node);
  }
  const explained = new Set(graph.roots);
  const stack = [...explained];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    for (const next of graph.successors[node]!) {
      if (!explained.has(next)) {
        explained.add(next);
        stack.push(next);
      }
    }
  }
  const unexplained = graph.size.reduce(
    (sum, size, node) => (graph.output[node] === ".text" && !explained.has(node) ? sum + size : sum),
    0,
  );
  if (unexplained > mostUnexplainedCode) {
    throw new Error(
      `nothing that could be read names ${(unexplained / 1e6).toFixed(2)} MB of the code in ${link.executable}: an input of the link was not understood`,
    );
  }
  for (let node = 0; node + 1 < count; node++) {
    const padding = graph.address[node + 1]! - graph.address[node]! - graph.size[node]!;
    if (graph.output[node] === graph.output[node + 1] && padding > 0 && padding < graph.alignment[node + 1]!)
      graph.size[node]! += padding;
  }
  const code = [...leaderOf.keys()].filter(node => graph.output[node] === ".text");
  const folded = [...graph.aliases.values()].flat();
  const spelled = spelledAsElsewhere(link.objdump, link.work, [
    ...code.map(node => leaderOf.get(node)!),
    ...folded.map(([, name]) => name.slice(1)),
  ]);
  code.forEach((node, index) => graph.functionName.set(node, spelled[index]!));
  folded.forEach((alias, index) => void (alias[1] = "_" + spelled[code.length + index]!));
  writeFileSync(
    join(link.work, "unresolved.txt"),
    [...unresolved]
      .sort((a, b) => b[1] - a[1])
      .map(([name, times]) => `${times} ${name}\n`)
      .join(""),
  );
  return graph;
}
