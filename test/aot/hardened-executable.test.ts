import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isGlibc, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { readElfFile, stackMayBeRead, stackMayBeWritten, type ElfFile } from "./elf-file";
import { isHardened, locksEnvironment } from "./hardened";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

const isX64 = process.arch === "x64";
const runtime = isLinux ? readElfFile(bunExe()) : undefined;

const program = `class Point {
  constructor(public x: number, public y: number) {}
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
console.log(new Point(3, 4).length());
`;

async function run(cmd: string[], env: Record<string, string | undefined> = bunEnv) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, undefined, env);
  return { stdout, stderr, exitCode };
}

const programThatCompresses = `import { readFileSync } from "node:fs";
import { gunzipSync, gzip, gzipSync } from "node:zlib";
const text = Buffer.alloc(1 << 16, "second stack ");
const onThisThread = gunzipSync(gzipSync(text)).equals(text);
const onAnotherThread = await new Promise<boolean>(resolve => gzip(text, (error, packed) => resolve(!error && gunzipSync(packed).equals(text))));
const guards = readFileSync("/proc/self/maps", "utf8").split("\\n").filter(line => {
  const [range, access] = line.split(" ");
  const [from, to] = range.split("-").map(part => parseInt(part, 16));
  return access === "---p" && to - from >= 256 * 1024 && to - from <= 1024 * 1024;
});
console.log(onThisThread, onAnotherThread, guards.length >= 2);
`;

// Counts the pages that can be written, the stack aside, with 64 or more words that point into the compiled code of the program.
const programThatLooksForTablesOfCode = `import { openSync, readFileSync, readSync } from "node:fs";
class Point {
  constructor(public x: number, public y: number) {}
  get sum(): number { return this.x + this.y; }
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
const things: any[] = [new Point(3, 4), { x: 1, y: 2, sum: 3, length: () => 0 }, [1, 2, 3], "text", new Map([["x", 1]]), () => 1];
let found = 0;
for (const name of ["x", "y", "sum", "length", "size", "absent"]) for (const thing of things) if (thing[name] !== undefined) found++;

const pageSize = 4096;
const pagesAtOnce = 65536;
const mappings = readFileSync("/proc/self/maps", "utf8").split("\\n").filter(line => line).map(line => {
  const [range, access, offset, , , path = ""] = line.split(/\\s+/);
  const [from, to] = range.split("-").map(part => parseInt(part, 16));
  return { from, to, access, offset: parseInt(offset, 16), path };
});
const code = mappings.filter(each => each.access[2] === "x" && each.path === process.execPath).sort((a, b) => b.offset - a.offset)[0];
const memory = openSync("/proc/self/mem", "r");
const residence = openSync("/proc/self/pagemap", "r");
const entries = new Uint32Array(2 * pagesAtOnce);
const words = new Uint32Array(pageSize / 4);
let tables = 0;
for (const { from, to, access, path } of mappings) {
  if (!access.startsWith("rw") || path === "[stack]") continue;
  for (let first = from; first < to; first += pagesAtOnce * pageSize) {
    const pages = Math.min(pagesAtOnce, (to - first) / pageSize);
    readSync(residence, entries, 0, pages * 8, (first / pageSize) * 8);
    for (let page = 0; page < pages; page++) {
      if (!(entries[2 * page + 1] >>> 31)) continue;
      if (readSync(memory, words, 0, pageSize, first + page * pageSize) !== pageSize) continue;
      let count = 0;
      for (let index = 0; index < words.length; index += 2) {
        const word = words[index + 1] * 2 ** 32 + words[index];
        if (word >= code.from && word < code.to) count++;
      }
      if (count >= 64) tables++;
    }
  }
}

const allCode = mappings.filter(each => each.access[2] === "x");
const isCode = (address: number) => allCode.some(each => address >= each.from && address < each.to);
const wordAt = (from: Uint32Array, index: number) => from[2 * index + 1] * 2 ** 32 + from[2 * index];
const records = new Uint32Array(64);
// Eight records in a row, of one to four words each, with an address of code at the same place in each.
function isTableOfCode(address: number) {
  if (address % 8 || address < 65536 || address >= 2 ** 47) return false;
  try {
    if (readSync(memory, records, 0, 256, address) !== 256) return false;
  } catch {
    return false;
  }
  for (let size = 1; size <= 4; size++) {
    for (let place = 0; place < size; place++) {
      let record = 0;
      while (record < 8 && isCode(wordAt(records, size * record + place))) record++;
      if (record === 8) return true;
    }
  }
  return false;
}
function wordsThatLeadToTables({ from, to }: { from: number; to: number }) {
  let count = 0;
  for (let page = from; page < to; page += pageSize) {
    readSync(residence, entries, 0, 8, (page / pageSize) * 8);
    if (!(entries[1] >>> 31) || readSync(memory, words, 0, pageSize, page) !== pageSize) continue;
    for (let index = 0; index < pageSize / 8; index++) if (isTableOfCode(wordAt(words, index))) count++;
  }
  return count;
}
// The words that nothing writes once compiled code runs lie between the other words that compiled code finds from the same address.
const isAnonymous = (index: number, access: string) => mappings[index].access === access && !mappings[index].path;
let instances = 0;
let writableWords = 0;
for (let index = 1; index + 1 < mappings.length; index++) {
  if (!isAnonymous(index - 1, "rw-p") || !isAnonymous(index, "r--p") || !isAnonymous(index + 1, "rw-p")) continue;
  if (mappings[index - 1].to !== mappings[index].from || mappings[index].to !== mappings[index + 1].from) continue;
  if (!wordsThatLeadToTables(mappings[index])) continue;
  instances++;
  writableWords += wordsThatLeadToTables(mappings[index - 1]) + wordsThatLeadToTables(mappings[index + 1]);
}
console.log(found, tables, instances, writableWords);
`;

async function withCompiledProgram(
  check: (file: ElfFile, path: string) => void | Promise<void>,
  source = program,
  output = "5\n",
) {
  using dir = tempDir("aot-hardened-executable", { "program.ts": source });
  const executable = join(String(dir), "program");
  const built = await run([
    bunExe(),
    "build",
    "--compile",
    "--aot",
    join(String(dir), "program.ts"),
    "--outfile",
    executable,
  ]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  expect(await run([executable])).toEqual({ stdout: output, stderr: "", exitCode: 0 });
  await check(readElfFile(executable), executable);
}

const canaryLoad = /\x64[\x48\x4c]\x8b[\x04\x0c\x14\x1c\x24\x2c\x34\x3c]\x25\x28\x00\x00\x00/g;
const pageProbe = /\x48\x81\xec\x00\x10\x00\x00\x48\xc7\x04\x24\x00\x00\x00\x00/g;
const systemLibrary =
  /^(libc|libm|libdl|libpthread|ld-linux-[a-z0-9-]+|libc\.musl-[a-z0-9_]+|libstdc\+\+|libgcc_s|libicu(data|i18n|uc))\.so(\.\d+)*$/;

describe.skipIf(!isLinux)("every executable", () => {
  test("has a stack that cannot be executed", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file]) expect(each.stackFlags).toBe(stackMayBeRead | stackMayBeWritten);
    });
  }, 120_000);

  // AddressSanitizer needs libraries of its own.
  test.skipIf(isASAN)(
    "names no folder to look for libraries in and needs system libraries only",
    async () => {
      await withCompiledProgram(file => {
        for (const each of [runtime!, file]) {
          expect(each.librarySearchPaths).toEqual([]);
          expect(each.neededLibraries.filter(name => !systemLibrary.test(name))).toEqual([]);
        }
      });
    },
    120_000,
  );
});

describe.skipIf(!isHardened)("an executable of a Bun built with --hardened=on", () => {
  test.skipIf(!isX64)(
    "checks a canary before its functions return",
    async () => {
      await withCompiledProgram(file => {
        for (const each of [runtime!, file]) {
          expect(each.importedSymbols).toContain("__stack_chk_fail");
          expect(each.countInCode(canaryLoad)).toBeGreaterThan(20_000);
        }
      });
    },
    120_000,
  );

  test.skipIf(!isGlibc)(
    "calls the checked forms of the C library's copying and formatting functions",
    async () => {
      await withCompiledProgram(file => {
        for (const each of [runtime!, file])
          expect([...each.importedSymbols]).toEqual(
            expect.arrayContaining(["__memcpy_chk", "__snprintf_chk", "__strcpy_chk"]),
          );
      });
    },
    120_000,
  );

  test("stops at an integer overflow in Rust", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file]) expect(each.contains("attempt to add with overflow")).toBe(true);
    });
  }, 120_000);

  test("checks what unsafe Rust promises the standard library", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file])
        expect(each.contains("unsafe precondition(s) violated: slice::get_unchecked")).toBe(true);
    });
  }, 120_000);

  // Where the environment is locked the allocator cannot be asked: the executable does not start with MIMALLOC_VERBOSE.
  test.skipIf(locksEnvironment)(
    "has an allocator that guards its own records",
    async () => {
      await withCompiledProgram(async (_, path) => {
        expect((await run([path], { ...bunEnv, MIMALLOC_VERBOSE: "1" })).stderr).toContain("secure level: 1");
      });
    },
    120_000,
  );

  test.skipIf(!isX64 || !isGlibc)(
    "gives every thread a second stack between guards for the arrays of its C libraries",
    async () => {
      await withCompiledProgram(
        file => {
          for (const each of [runtime!, file]) expect(each.earlyInitializers).toBe(1);
        },
        programThatCompresses,
        "true true true\n",
      );
    },
    120_000,
  );

  test.skipIf(!isX64)(
    "keeps the tables of addresses that compiled code jumps through, and the words that lead to them, on pages that cannot be written",
    async () => {
      await withCompiledProgram(() => {}, programThatLooksForTablesOfCode, "12 0 1 0\n");
    },
    120_000,
  );

  test.skipIf(!isX64)(
    "touches every page of a large frame",
    async () => {
      await withCompiledProgram(file => {
        for (const each of [runtime!, file]) expect(each.countInCode(pageProbe)).toBeGreaterThan(0);
      });
    },
    120_000,
  );
});
