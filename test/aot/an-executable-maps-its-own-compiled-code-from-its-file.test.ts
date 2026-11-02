// A measurement, not a test to keep: whether macOS lets an executable map the compiled code of its own file to be
// executed, the way the engine maps the code of an image from a file, when the executable is signed ad hoc, and when it
// is signed with the hardened runtime.
import { expect } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findImage, imageHeader } from "./cli/compiled-image";
import { test } from "./supported";

// The arguments say where the executed part of the image is in the file, and how long it is.
const maps = `import { dlopen, FFIType, read } from "bun:ffi";
import { openSync } from "node:fs";

const file = openSync(process.execPath, "r");
const code = { offset: Number(process.argv[2]), size: Number(process.argv[3]) };
const system = dlopen("libSystem.B.dylib", {
  mmap: { args: [FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
  mprotect: { args: [FFIType.u64, FFIType.u64, FFIType.i32], returns: FFIType.i32 },
  __error: { args: [], returns: FFIType.ptr },
});
const errno = () => read.i32(system.symbols.__error()!, 0);
const [readOnly, readAndExecute, isPrivate, isFixed] = [1, 5, 2, 0x10];
const failed = (address: number | bigint) => BigInt(address) === -1n;

// Over a mapping that is only read, as the engine maps it. If that is refused, by a change of the protection.
const readable = system.symbols.mmap(0, code.size, readOnly, isPrivate, file, code.offset);
const over = failed(readable) ? -1n : system.symbols.mmap(readable, code.size, readAndExecute, isPrivate | isFixed, file, code.offset);
const overError = failed(over) ? errno() : 0;
const protectedLater = failed(over) && !failed(readable) ? system.symbols.mprotect(readable, code.size, readAndExecute) : 0;
const protectError = protectedLater ? errno() : 0;
// At an address of the system's choice.
const direct = system.symbols.mmap(0, code.size, readAndExecute, isPrivate, file, code.offset);
const directError = failed(direct) ? errno() : 0;
// The system checks a page against the signature when the page is first read.
const firstByte = failed(direct) ? -1 : read.u8(Number(direct) as any, 0);
console.log(JSON.stringify({ over: !failed(over), overError, protectedLater: protectedLater === 0, protectError, direct: !failed(direct), directError, firstByte }));
`;

const asksForExecutableMemory = `import { dlopen, FFIType } from "bun:ffi";
const system = dlopen("libSystem.B.dylib", {
  mmap: { args: [FFIType.u64, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
});
const address = system.symbols.mmap(0, 1 << 14, 7, 2 | 0x1000 | 0x800, -1, 0);
console.log(BigInt(address) === -1n ? "refused" : "granted");
`;

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, typeRoots: [join(import.meta.dir, "..", "..", "packages")], types: ["bun-types"] },
});

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.skipIf(!isMacOS)(
  "macOS lets a signed executable map its own compiled code from its file",
  async () => {
    using dir = tempDir("aot-own-file-mapping", {
      "maps.ts": maps,
      "asks.ts": asksForExecutableMemory,
      "tsconfig.json": tsconfig,
    });
    const folder = String(dir);
    for (const name of ["maps", "asks"]) {
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", join(folder, `${name}.ts`), "--outfile", join(folder, name)],
        folder,
      );
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    }
    const signed = async (name: string, suffix: string, options: string[]) => {
      const copy = join(folder, name + suffix);
      copyFileSync(join(folder, name), copy);
      const { exitCode, stderr } = await run(["codesign", "--force", "--sign", "-", ...options, copy], folder);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.any(String) });
      return copy;
    };
    const file = readFileSync(join(folder, "maps"));
    const image = findImage(file);
    const code = image + Number(file.readBigUInt64LE(image + imageHeader.codeOffset));
    const codeSize = Number(file.readBigUInt64LE(image + imageHeader.executableSize));
    const answer = async (executable: string) => {
      const { stdout, stderr, exitCode, signalCode } = await run([executable, String(code), String(codeSize)], folder);
      try {
        return { ...JSON.parse(stdout), exitCode, signalCode };
      } catch {
        return { stdout, stderr: stderr.trim().split("\n").slice(-3).join(" | "), exitCode, signalCode };
      }
    };
    const control = async (executable: string) => (await run([executable], folder)).stdout.trim();
    const hardened = ["--options", "runtime"];

    const granted = {
      over: true,
      overError: 0,
      protectedLater: true,
      protectError: 0,
      direct: true,
      directError: 0,
      firstByte: file[code],
      exitCode: 0,
      signalCode: null,
    };
    const system = (await run(["sw_vers", "-productVersion"], folder)).stdout.trim() + " " + process.arch;
    expect({
      system,
      asBuilt: await answer(join(folder, "maps")),
      signedAgain: await answer(await signed("maps", "-signed", [])),
      hardened: await answer(await signed("maps", "-hardened", hardened)),
      // An executable that is signed with the hardened runtime, without the entitlement, gets no memory for generated
      // code. Where it does, the system does not enforce the hardened runtime, and `hardened` says nothing of it.
      controlAsBuilt: await control(join(folder, "asks")),
      controlHardened: await control(await signed("asks", "-hardened", hardened)),
    }).toEqual({
      system,
      asBuilt: granted,
      signedAgain: granted,
      hardened: granted,
      controlAsBuilt: "granted",
      controlHardened: "refused",
    });
  },
  300_000,
);
