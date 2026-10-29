import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join, resolve } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// An ELF shared object with no code, no symbols and no dependencies.
function emptySharedObject() {
  const [segments, dynamic, hash, symbols, strings, size] = [0x40, 0xe8, 0x148, 0x158, 0x170, 0x178];
  const [load, dynamicSegment, stack, readWrite] = [1, 2, 0x6474e551, 6];
  const file = Buffer.alloc(size);
  file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  file.writeUInt16LE(3, 16);
  file.writeUInt16LE(process.arch === "arm64" ? 183 : 62, 18);
  file.writeUInt32LE(1, 20);
  file.writeUInt32LE(segments, 32);
  file.writeUInt16LE(64, 52);
  file.writeUInt16LE(56, 54);
  file.writeUInt16LE(3, 56);
  [
    [load, 0, size, 0x10000],
    [dynamicSegment, dynamic, hash - dynamic, 8],
    [stack, 0, 0, 16],
  ].forEach(([type, offset, length, alignment], index) => {
    const header = segments + 56 * index;
    file.writeUInt32LE(type, header);
    file.writeUInt32LE(readWrite, header + 4);
    [offset, offset, offset, length, length, alignment].forEach((value, field) =>
      file.writeUInt32LE(value, header + 8 + 8 * field),
    );
  });
  [
    [4, hash],
    [5, strings],
    [6, symbols],
    [10, 1],
    [11, 24],
  ].forEach(([tag, value], index) => {
    file.writeUInt32LE(tag, dynamic + 16 * index);
    file.writeUInt32LE(value, dynamic + 16 * index + 8);
  });
  file.writeUInt32LE(1, hash);
  file.writeUInt32LE(1, hash + 4);
  return file;
}

test.skipIf(!isMacOS && !isLinux)(
  "an executable runs its compiled code with libraries inserted by the loader",
  async () => {
    using dir = tempDir("aot-inserted-library", {
      "main.ts": `
        import { readFileSync } from "node:fs";
        console.log("hello");
        if (process.platform === "linux") {
          const mapped = new Set(readFileSync("/proc/self/maps", "utf8").match(/inserted-\\d\\.so/g));
          for (const library of [...mapped].sort()) console.log(library);
        }
      `,
      "inserted-1.so": emptySharedObject(),
      "inserted-2.so": emptySharedObject(),
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "program"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
      stderr: expect.any(String),
      exitCode: 0,
    });
    const libraries = isMacOS
      ? ["/usr/lib/libz.1.dylib", "/usr/lib/libbz2.1.0.dylib"]
      : ["inserted-1.so", "inserted-2.so"];
    for (let count = 0; count <= libraries.length; count++) {
      const inserted = libraries.slice(0, count);
      const result = await run([join(String(dir), "program")], String(dir), {
        ...bunEnv,
        [isMacOS ? "DYLD_INSERT_LIBRARIES" : "LD_PRELOAD"]: count
          ? inserted.map(library => resolve(String(dir), library)).join(":")
          : undefined,
        BUN_JSC_crashIfInterpreterIsUsed: "1",
      });
      expect({ inserted, ...result }).toEqual({
        inserted,
        stdout: ["hello", ...(isLinux ? inserted : []), ""].join("\n"),
        stderr: "",
        exitCode: 0,
      });
    }
  },
  120_000,
);
