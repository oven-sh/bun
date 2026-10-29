import { describe, expect } from "bun:test";
import { bunExe, isLinux, libcPathForDlopen, readElf64ProgramHeaders, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { isHardened } from "./hardened";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const [load, dynamic, gnuRelro] = [1, 2, 0x6474e552];
const [mayExecute, mayWrite] = [1, 2];
const [flags, flags1, bindNow, now] = [30n, 0x6ffffffbn, 8n, 1n];
const sharedObject = 3;
const noBits = 8;
const pageSize = 4096n;

function describeLayout(path: string) {
  const file = readFileSync(path);
  const headers = readElf64ProgramHeaders(path);
  const loads = headers.filter(header => header.type === load && header.filesz > 0n);
  const table = headers.find(header => header.type === dynamic)!;
  const entries = Array.from(
    { length: Number(table.filesz / 16n) },
    (_, index) => Number(table.offset) + index * 16,
  ).map(at => ({
    tag: file.readBigUInt64LE(at),
    value: file.readBigUInt64LE(at + 8),
  }));
  const has = (tag: bigint, bit: bigint) => entries.some(entry => entry.tag === tag && entry.value & bit);
  const pagesOf = (isWanted: (flags: number) => boolean) =>
    new Set(
      loads
        .filter(header => isWanted(header.flags))
        .flatMap(header => [header.offset / pageSize, (header.offset + header.filesz - 1n) / pageSize]),
    );
  const codePages = pagesOf(flags => !!(flags & mayExecute));
  const sections = Array.from(
    { length: file.readUInt16LE(60) },
    (_, index) => Number(file.readBigUInt64LE(40)) + index * file.readUInt16LE(58),
  )
    .filter(at => file.readUInt32LE(at + 4) !== noBits)
    .map(at => ({
      start: file.readBigUInt64LE(at + 24),
      end: file.readBigUInt64LE(at + 24) + file.readBigUInt64LE(at + 32),
    }));
  const unusedPages = loads.map(({ offset, filesz }) => {
    const ends = sections
      .filter(section => section.start < offset + filesz && section.end > offset)
      .map(section => section.end);
    const used = ends.reduce((last, end) => (end > last ? end : last), offset);
    return used < offset + filesz ? (offset + filesz - used) / pageSize : 0n;
  });
  return {
    isPositionIndependent: file.readUInt16LE(16) === sharedObject,
    hasRelro: headers.some(header => header.type === gnuRelro),
    bindsAtStartup: has(flags, bindNow) || has(flags1, now),
    writableAndExecutableSegments: loads.filter(header => header.flags & mayWrite && header.flags & mayExecute).length,
    pagesSharedByCodeAndData: [...pagesOf(flags => !(flags & mayExecute))].filter(page => codePages.has(page)).length,
    pagesInNoSection: Number(unusedPages.reduce((sum, pages) => sum + pages, 0n)),
  };
}

const hardened = {
  isPositionIndependent: true,
  hasRelro: true,
  bindsAtStartup: true,
  writableAndExecutableSegments: 0,
  pagesSharedByCodeAndData: 0,
  pagesInNoSection: 0,
};

const program = `import { dlopen, FFIType } from "bun:ffi";
import { readFileSync } from "node:fs";
const libc = dlopen(${JSON.stringify(isLinux ? libcPathForDlopen() : "")}, {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
});
console.log(libc.symbols.prctl(66, 0, 0, 0, 0));
console.log(readFileSync("/proc/self/maps", "utf8"));
`;

async function run(cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd);
  return { stdout, stderr, exitCode };
}

const waysToBuild: [string, string[]][] = [["--aot", ["--aot"]]];
if (canTrim) waysToBuild.push(["--aot --trim", ["--aot", "--trim"]]);

describe.skipIf(!isHardened)("a Bun built with --hardened=on", () => {
  test("is position-independent with full RELRO and separate code", () => {
    expect(describeLayout(bunExe())).toEqual(hardened);
  });

  test.each(waysToBuild)(
    "builds executables with the same layout, which load at a different address each time: %s",
    async (_, options) => {
      using dir = tempDir("aot-hardened-layout", { "program.ts": program });
      const executable = join(String(dir), "program");
      const built = await run([
        bunExe(),
        "build",
        "--compile",
        ...options,
        join(String(dir), "program.ts"),
        "--outfile",
        executable,
      ]);
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
      expect(describeLayout(executable)).toEqual(hardened);

      const runs = await Promise.all(Array.from({ length: 3 }, () => run([executable])));
      for (const { stderr, exitCode } of runs) expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const lines = runs.map(({ stdout }) => stdout.split("\n"));
      for (const [denyWriteExecute] of lines) expect(["1", "-1"]).toContain(denyWriteExecute);
      const bases = lines.map(mappings => mappings.find(line => line.endsWith(executable))!.split("-")[0]);
      expect(new Set(bases).size).toBe(bases.length);
      for (const mappings of lines) expect(mappings.filter(line => /^\S+ .wx/.test(line))).toEqual([]);

      const relro = readElf64ProgramHeaders(executable).find(header => header.type === gnuRelro)!;
      for (const mappings of lines) {
        const startOfFile = mappings.find(line => /^\S+ \S+ 0+ /.test(line) && line.endsWith(executable))!;
        const start = BigInt("0x" + startOfFile.split("-")[0]) + relro.vaddr;
        const end = start + (relro.memsz / pageSize) * pageSize;
        const permissions = mappings
          .map(line => /^([0-9a-f]+)-([0-9a-f]+) (\S+)/.exec(line))
          .filter(match => match && BigInt("0x" + match[1]) < end && BigInt("0x" + match[2]) > start)
          .map(match => match![3]);
        expect(new Set(permissions)).toEqual(new Set(["r--p"]));
      }
    },
    120_000,
  );
});
