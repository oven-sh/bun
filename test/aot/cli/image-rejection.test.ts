import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";
import { findImage, imageHeader } from "./compiled-image";
import { runCopy, type SpawnResult } from "./edited-executable";

const results: Record<string, SpawnResult> = {};
let folder = "";
afterAll(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const uint64 = (value: bigint) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
};
const flipByte = (at: number) => (header: Buffer) => ({ at, bytes: Buffer.from([header[at]! ^ 0xff]) });

const environments: Record<string, Record<string, string>> = {
  CompiledCodeDisabled: { BUN_JSC_useAOT: "0" },
  OptionsConflict: { BUN_JSC_sizeClassProgression: "1.5" },
};

const edits: Record<string, (header: Buffer) => { at: number; bytes: Buffer }> = {
  NotAnImage: flipByte(imageHeader.magic),
  IdentityMismatch: flipByte(imageHeader.identity),
  StampMismatch: flipByte(imageHeader.stamp),
  Truncated: header => ({ at: imageHeader.size, bytes: uint64(header.readBigUInt64LE(imageHeader.size) + 16384n) }),
  MalformedTables: header => ({
    at: imageHeader.codeOffset,
    bytes: uint64(header.readBigUInt64LE(imageHeader.codeOffset) + 1n),
  }),
};

const sentences: Record<string, string> = {
  CompiledCodeDisabled: "compiled code is disabled (BUN_JSC_useAOT=0)",
  OptionsConflict:
    "it was built with different engine options than this process uses. Unset any BUN_JSC_* environment variables, or rebuild",
  NotAnImage: "the file is corrupt (bad header)",
  IdentityMismatch: "it was built for a different build of Bun than the one in this executable. Rebuild it",
  StampMismatch: "the compiler that built it doesn't match the runtime in this executable. Rebuild it",
  Truncated: "the file is truncated. Copy or download it again",
  MalformedTables: "the file is corrupt (bad tables)",
};

const causes = [...Object.keys(environments), ...Object.keys(edits)];

beforeAll(async () => {
  folder = String(
    tempDir("aot-image-rejection", { "entry.ts": `const n: number = 1 + 1;\nconsole.log("answer", n);\n` }),
  );
  const executable = join(folder, isWindows ? "out.exe" : "out");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), "entry.ts", "--outfile", "out"],
      folder,
      bunEnv,
    ),
  );

  results.Accepted = await spawned([executable], folder, bunEnv);
  for (const [name, environment] of Object.entries(environments)) {
    results[name] = await spawned([executable], folder, { ...bunEnv, ...environment });
  }

  const original = readFileSync(executable);
  const image = findImage(original);
  const header = original.subarray(image, image + imageHeader.prefixSize);
  for (const [name, edit] of Object.entries(edits)) {
    const { at, bytes } = edit(header);
    const copy = Buffer.from(original);
    bytes.copy(copy, image + at);
    results[name] = await runCopy(folder, copy, bunEnv);
  }
  results.AcceptedCopy = await runCopy(folder, original, bunEnv);
}, 300_000);

describe("compiled image rejection", () => {
  test("accepts the executable as built and an unedited copy", () => {
    for (const name of ["Accepted", "AcceptedCopy"]) {
      expect(results[name]).toEqual({ stdout: "answer 2\n", stderr: "", exitCode: 0, signal: null });
    }
  });

  test.each(causes)("%s", name => {
    expect(results[name]).toEqual({
      stdout: "",
      stderr: `error: can't run this executable's compiled code: ${sentences[name]}\n`,
      exitCode: 1,
      signal: null,
    });
  });

  test("every cause has a distinct message", () => {
    expect(new Set(Object.values(sentences)).size).toBe(Object.keys(sentences).length);
    expect(Object.keys(sentences).sort()).toEqual([...causes].sort());
  });
});
