import { expect } from "bun:test";
import { bunEnv, bunExe, isGlibc, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { readElfFile, stackMayBeRead, stackMayBeWritten, type ElfFile } from "./elf-file";
import { isHardened } from "./hardened";
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
  await using proc = Bun.spawn({ cmd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
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

async function withCompiledProgram(check: (file: ElfFile, path: string) => void | Promise<void>, source = program, output = "5\n") {
  using dir = tempDir("aot-hardened-executable", { "program.ts": source });
  const executable = join(String(dir), "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", join(String(dir), "program.ts"), "--outfile", executable]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  expect(await run([executable])).toEqual({ stdout: output, stderr: "", exitCode: 0 });
  await check(readElfFile(executable), executable);
}

const canaryLoad = /\x64[\x48\x4c]\x8b[\x04\x0c\x14\x1c\x24\x2c\x34\x3c]\x25\x28\x00\x00\x00/g;
const pageProbe = /\x48\x81\xec\x00\x10\x00\x00\x48\xc7\x04\x24\x00\x00\x00\x00/g;
const systemLibrary = /^(libc|libm|libdl|libpthread|ld-linux-[a-z0-9-]+|libc\.musl-[a-z0-9_]+|libstdc\+\+|libgcc_s|libicu(data|i18n|uc))\.so(\.\d+)*$/;

describe.skipIf(!isLinux)("every executable", () => {
  test("has a stack that cannot be executed", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file]) expect(each.stackFlags).toBe(stackMayBeRead | stackMayBeWritten);
    });
  }, 120_000);

  test("names no folder to look for libraries in and needs system libraries only", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file]) {
        expect(each.librarySearchPaths).toEqual([]);
        expect(each.neededLibraries.filter(name => !systemLibrary.test(name))).toEqual([]);
      }
    });
  }, 120_000);
});

describe.skipIf(!isHardened)("an executable of a Bun built with --hardened=on", () => {
  test.skipIf(!isX64)("checks a canary before its functions return", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file]) {
        expect(each.importedSymbols).toContain("__stack_chk_fail");
        expect(each.countInCode(canaryLoad)).toBeGreaterThan(20_000);
      }
    });
  }, 120_000);

  test.skipIf(!isGlibc)("calls the checked forms of the C library's copying and formatting functions", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file]) expect([...each.importedSymbols]).toEqual(expect.arrayContaining(["__memcpy_chk", "__snprintf_chk", "__strcpy_chk"]));
    });
  }, 120_000);

  test("stops at an integer overflow in Rust", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file]) expect(each.contains("attempt to add with overflow")).toBe(true);
    });
  }, 120_000);

  test("checks what unsafe Rust promises the standard library", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file]) expect(each.contains("unsafe precondition(s) violated: slice::get_unchecked")).toBe(true);
    });
  }, 120_000);

  test("has an allocator that guards its own records", async () => {
    await withCompiledProgram(async (_, path) => {
      expect((await run([path], { ...bunEnv, MIMALLOC_VERBOSE: "1" })).stderr).toContain("secure level: 1");
    });
  }, 120_000);

  test.skipIf(!isX64 || !isGlibc)("gives every thread a second stack between guards for the arrays of its C libraries", async () => {
    await withCompiledProgram(
      file => {
        for (const each of [runtime!, file]) expect(each.earlyInitializers).toBe(1);
      },
      programThatCompresses,
      "true true true\n",
    );
  }, 120_000);

  test.skipIf(!isX64)("touches every page of a large frame", async () => {
    await withCompiledProgram(file => {
      for (const each of [runtime!, file]) expect(each.countInCode(pageProbe)).toBeGreaterThan(0);
    });
  }, 120_000);
});
