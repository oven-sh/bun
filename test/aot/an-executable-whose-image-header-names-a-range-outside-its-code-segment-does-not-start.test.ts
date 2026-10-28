import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import {
  bunEnv,
  bunExe,
  isArm64,
  isLinux,
  isWindows,
  readElf64ProgramHeaders,
  tempDirWithBunTypes as tempDir,
} from "harness";
import { join } from "path";
import { findImage, imageHeader } from "./cli/compiled-image";
import { runCopy, type SpawnResult } from "./cli/edited-executable";
import { isHardened } from "./hardened";
import { built, spawned, withoutDebugInformation } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

// Eight classes are too many to tell apart by tests: the calls of `area` go through the image's method table, which has the last pages in front of the code to itself.
const program = `interface Shape { area(): number }
${Array.from("ABCDEFGH", (name, index) => `class ${name} implements Shape { constructor(public n: number) {} area(): number { return this.n * ${index + 1}; } }`).join("\n")}
const makers = [A, B, C, D, E, F, G, H];
const shapes: Shape[] = [];
for (let i = 0; i < 8 + process.argv.length - 2; i++) shapes.push(new makers[i % 8](1));
let sum = 0;
for (const shape of shapes) sum += shape.area();
console.log("answer", sum * 0.125, /^a+[b-y\\u00e0-\\u00ff\\u0430-\\u044f]?z$/.test("aaz"));
`;

const imagePage = isLinux && isArm64 ? 65536 : 16384;
const corrupt = "the file is corrupt (bad tables)";
const outside =
  "its header names code or data outside the segments the executable loads them in. Something modified the executable after it was built";

class Header {
  constructor(
    readonly file: Buffer,
    readonly image: number,
  ) {}
  get(member: number) {
    return Number(this.file.readBigUInt64LE(this.image + member));
  }
  set(member: number, value: number) {
    this.file.writeBigUInt64LE(BigInt(value), this.image + member);
  }
  get32(member: number) {
    return this.file.readUInt32LE(this.image + member);
  }
  set32(member: number, value: number) {
    this.file.writeUInt32LE(value, this.image + member);
  }
  /** No section reaches behind `limit`, as the header's own check asks of the sections and the start of the code. */
  endSectionsAt(limit: number) {
    for (let index = 0; index < imageHeader.numberOfSections; index++) {
      const at = imageHeader.sections + 8 * index;
      const [offset, size] = [this.get32(at), this.get32(at + 4)];
      if (offset + size <= limit) continue;
      this.set32(at, Math.min(offset, limit));
      this.set32(at + 4, Math.max(0, limit - offset) & ~15);
    }
  }
}

const { size, codeOffset, codeSize, executableSize, constantsOffset, constantsSize } = imageHeader;

const headersThatContradictThemselves: Record<string, (header: Header) => void> = {
  "begins a page early": header => header.set(codeOffset, header.get(codeOffset) - imagePage),
  "is the tables": header => {
    header.set(executableSize, header.get(codeOffset) - imagePage);
    header.set(size, header.get(codeOffset));
    header.set(codeOffset, imagePage);
  },
  "is empty": header => header.set(executableSize, 0),
  "lies behind the end of the file": header =>
    header.set(codeOffset, Math.ceil(header.file.length / imagePage + 1) * imagePage),
};

const headersThatAgreeWithThemselves: Record<string, (header: Header) => void> = {
  "begins a page early": header => {
    header.set(codeOffset, header.get(codeOffset) - imagePage);
    header.endSectionsAt(header.get(codeOffset));
  },
  "ends a page late": header => {
    const end = header.get(executableSize) + imagePage;
    header.set(executableSize, end);
    header.set(codeSize, header.get(size) - header.get(codeOffset));
    const constants = Math.max(header.get32(constantsOffset), end);
    header.set32(constantsSize, Math.max(0, header.get32(constantsOffset) + header.get32(constantsSize) - constants));
    header.set32(constantsOffset, constants);
  },
};

const [loadable, mayWrite, flagsOffset, offsetOffset, programHeaderSize] = [1, 2, 4, 8, 56];

/** Where in `file` the program header of the loadable segment lies that holds the byte at `offset` of the file. */
function findProgramHeader(file: Buffer, path: string, offset: number) {
  const index = readElf64ProgramHeaders(path).findIndex(
    header =>
      header.type === loadable && header.offset <= BigInt(offset) && BigInt(offset) < header.offset + header.filesz,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  return Number(file.readBigUInt64LE(32)) + index * programHeaderSize;
}

function allowWritesAt(file: Buffer, path: string, offset: number) {
  const at = findProgramHeader(file, path, offset) + flagsOffset;
  file.writeUInt32LE(file.readUInt32LE(at) | mayWrite, at);
}

/** The form that the writer gives an executable whose table of program headers has room for one more header only. */
function loadPayloadAsOneSegment(file: Buffer, path: string) {
  const [payload, mayRead] = [0x6fb00002, 4];
  const headers = readElf64ProgramHeaders(path);
  const whole = headers.find(header => header.type === payload)!;
  const table = Number(file.readBigUInt64LE(32));
  headers.forEach((header, index) => {
    const at = table + index * programHeaderSize;
    const isPiece =
      header.type === loadable && whole.offset <= header.offset && header.offset < whole.offset + whole.filesz;
    if (isPiece) file.fill(0, at, at + programHeaderSize);
    if (header !== whole) return;
    file.writeUInt32LE(loadable, at);
    file.writeUInt32LE(mayRead | mayWrite, at + flagsOffset);
  });
}

function loadFromPageBefore(file: Buffer, path: string, offset: number) {
  const at = findProgramHeader(file, path, offset) + offsetOffset;
  file.writeBigUInt64LE(file.readBigUInt64LE(at) - BigInt(imagePage), at);
}

const results: Record<string, SpawnResult> = {};
let folder = "";
afterAll(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
});

beforeAll(async () => {
  folder = String(tempDir("aot-code-range", { "entry.ts": program }));
  const executable = join(folder, isWindows ? "out.exe" : "out");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), "entry.ts", "--outfile", "out"],
      folder,
      bunEnv,
    ),
  );
  const original = readFileSync(executable);
  const image = findImage(original);
  const runEdited = async (edit: (header: Header) => void) => {
    const header = new Header(Buffer.from(original), image);
    edit(header);
    return await runCopy(folder, header.file, bunEnv);
  };

  results.unedited = await runEdited(() => {});
  for (const [name, edit] of Object.entries(headersThatContradictThemselves)) {
    results["contradicts: " + name] = await runEdited(edit);
  }
  if (!isLinux) return;
  for (const [name, edit] of Object.entries(headersThatAgreeWithThemselves)) {
    results["agrees: " + name] = await runEdited(edit);
  }
  const code = image + Number(original.readBigUInt64LE(image + codeOffset));
  for (const [name, offset] of Object.entries({
    tables: image,
    code,
    data: image + Number(original.readBigUInt64LE(image + size)) - 1,
  })) {
    results["writable: " + name] = await runEdited(header => allowWritesAt(header.file, executable, offset));
  }
  results.oneSegment = await runEdited(header => loadPayloadAsOneSegment(header.file, executable));
  results.moved = await runEdited(header => loadFromPageBefore(header.file, executable, code));
}, 300_000);

const refusedWith = (sentence: string) => ({
  stdout: "",
  stderr: `error: can't run this executable's compiled code: ${sentence}\n`,
  exitCode: 1,
  signal: null,
});

describe("an executable whose image header names a range outside its code segment does not start", () => {
  test("an unedited copy runs", () => {
    expect(results.unedited).toEqual({ stdout: "answer 4.5 true\n", stderr: "", exitCode: 0, signal: null });
  });

  test.each(Object.keys(headersThatContradictThemselves))("the code %s", name => {
    expect(results["contradicts: " + name]).toEqual(refusedWith(corrupt));
  });

  test.skipIf(!isLinux).each(Object.keys(headersThatAgreeWithThemselves))(
    "the code %s, and the rest of the header agrees",
    name => {
      expect(results["agrees: " + name]).toEqual(refusedWith(outside));
    },
  );

  test.skipIf(!isLinux).each(["tables", "code", "data"])(
    "the executable loads the %s of the image to be written",
    name => {
      expect(results["writable: " + name]).toEqual(refusedWith(outside));
    },
  );

  test.skipIf(!isLinux)("an executable whose whole payload is one segment that is not executed starts", () => {
    expect(results.oneSegment).toEqual(isHardened ? refusedWith(outside) : results.unedited);
  });

  test.skipIf(!isLinux)("the executable loads its code from another place of the file than the header names", () => {
    expect(results.moved).toEqual(refusedWith(outside));
  });
});
