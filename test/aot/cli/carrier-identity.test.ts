import { expect } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isMacOS, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "../run-programs";
import { test } from "../supported";
import { runCopy, type SpawnResult } from "./edited-executable";

const timeout = 300_000;
const files = { "entry.ts": `const n: number = 20 + 1;\nconsole.log("answer", n * 2);\n` };

const executablePath = (folder: string, name: string) => join(folder, isWindows ? name + ".exe" : name);
const align4 = (size: number) => (size + 3) & ~3;

function findElfIdentityOffset(file: Buffer): number | undefined {
  const headers = Number(file.readBigUInt64LE(32));
  const headerSize = file.readUInt16LE(54);
  const headerCount = file.readUInt16LE(56);
  for (let i = 0; i < headerCount; i++) {
    const header = headers + i * headerSize;
    if (file.readUInt32LE(header) !== 4) continue;
    const start = Number(file.readBigUInt64LE(header + 8));
    const end = start + Number(file.readBigUInt64LE(header + 32));
    let note = start;
    while (note + 12 <= end) {
      const nameSize = file.readUInt32LE(note);
      const descriptorSize = file.readUInt32LE(note + 4);
      const descriptor = note + 12 + align4(nameSize);
      const isBuildId = file.readUInt32LE(note + 8) === 3 && nameSize === 4;
      if (isBuildId && file.latin1Slice(note + 12, note + 16) === "GNU\0" && descriptorSize >= 16) return descriptor;
      note = descriptor + align4(descriptorSize);
    }
  }
}

function findMachOIdentityOffset(file: Buffer): number | undefined {
  const commandCount = file.readUInt32LE(16);
  let at = 32;
  for (let i = 0; i < commandCount; i++) {
    if (file.readUInt32LE(at) === 0x1b) return at + 8;
    at += file.readUInt32LE(at + 4);
  }
}

function findPEIdentityOffset(file: Buffer): number | undefined {
  const pe = file.readUInt32LE(0x3c);
  const sectionCount = file.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const sections = optional + file.readUInt16LE(pe + 20);
  const debugDirectory = optional + 112 + 6 * 8;
  const debugAddress = file.readUInt32LE(debugDirectory);
  const debugSize = file.readUInt32LE(debugDirectory + 4);
  for (let i = 0; i < sectionCount; i++) {
    const section = sections + 40 * i;
    const virtualAddress = file.readUInt32LE(section + 12);
    const size = Math.max(file.readUInt32LE(section + 8), file.readUInt32LE(section + 16));
    if (debugAddress < virtualAddress || debugAddress >= virtualAddress + size) continue;
    const start = file.readUInt32LE(section + 20) + debugAddress - virtualAddress;
    for (let entry = start; entry + 28 <= start + debugSize; entry += 28) {
      if (file.readUInt32LE(entry + 12) !== 2) continue;
      const data = file.readUInt32LE(entry + 24);
      if (file.latin1Slice(data, data + 4) === "RSDS") return data + 4;
    }
  }
}

function findIdentityOffset(file: Buffer): number {
  let at: number | undefined;
  if (file.readUInt32BE(0) === 0x7f454c46) at = findElfIdentityOffset(file);
  else if (file.readUInt32LE(0) === 0xfeedfacf) at = findMachOIdentityOffset(file);
  else if (file.latin1Slice(0, 2) === "MZ") at = findPEIdentityOffset(file);
  if (at === undefined) throw new Error("no identity");
  return at;
}

function flipIdentity(file: Buffer) {
  const at = findIdentityOffset(file);
  file[at] = file[at]! ^ 0xff;
}

const hasIdentity = (() => {
  try {
    findIdentityOffset(readFileSync(bunExe()));
    return true;
  } catch {
    return false;
  }
})();

const identityRemovals: Record<string, (file: Buffer, at: number) => void> = {
  "no id": (file, at) => {
    if (isWindows) file.write("NB10", at - 4, "latin1");
    else if (isMacOS) file.writeUInt32LE(0x7fffffff, at - 8);
    else file[at - 8] = 0;
  },
  "sixteen zeros": (file, at) => file.fill(0, at, at + 16),
};

const build = (folder: string, carrier: string | null) =>
  spawned(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      ...(carrier ? ["--compile-executable-path", carrier] : []),
      "entry.ts",
      "--outfile",
      "out",
    ],
    folder,
    { ...bunEnv, NO_COLOR: "1" },
  );

function buildOnCarrier(folder: string, name: string, bytes: Buffer) {
  const carrier = join(folder, name);
  writeFileSync(carrier, bytes);
  chmodSync(carrier, 0o755);
  return build(folder, "./" + name);
}

function expectAnswer({ stdout, exitCode }: SpawnResult) {
  expect({ stdout, exitCode }).toEqual({ stdout: "answer 42\n", exitCode: 0 });
}

const strip = isWindows ? null : Bun.which("strip");

test.skipIf(!strip)(
  "a stripped copy of this Bun is the same build",
  async () => {
    if (!hasIdentity) return;
    using dir = tempDir("aot-carrier-stripped", files);
    const folder = String(dir);
    const copy = join(folder, "stripped");
    const stripped = await spawned([strip!, ...(isMacOS ? ["-S"] : []), "-o", copy, bunExe()], folder, bunEnv);
    expect(stripped.exitCode).toBe(0);

    const identity = (file: Buffer) => {
      const at = findIdentityOffset(file);
      return file.subarray(at, at + 16);
    };
    expect(identity(readFileSync(copy)).equals(identity(readFileSync(bunExe())))).toBe(true);

    built(await build(folder, "./stripped"));
    expectAnswer(await spawned([executablePath(folder, "out")], folder, bunEnv));
  },
  timeout,
);

test(
  "another link of the same run time is compiled onto, and the image names it",
  async () => {
    if (!hasIdentity) return;
    using dir = tempDir("aot-carrier-another-link", files);
    const folder = String(dir);
    const other = readFileSync(bunExe());
    flipIdentity(other);
    built(await buildOnCarrier(folder, "another-link", other));
    expectAnswer(await spawned([executablePath(folder, "out")], folder, bunEnv));
  },
  timeout,
);

function findDescriptionOfEngine(file: Buffer): number {
  for (let at = file.indexOf("BUNAOTRT"); at >= 0; at = file.indexOf("BUNAOTRT", at + 1)) {
    if (file.readUInt32LE(at + 8) === 32 + 4 * file.readUInt32LE(at + 12)) return at;
  }
  throw new Error("this Bun has no description of its run time");
}

test(
  "the image takes the form that the run time's description names",
  async () => {
    if (!hasIdentity) return;
    using dir = tempDir("aot-carrier-other-form", files);
    const folder = String(dir);
    const other = readFileSync(bunExe());
    other[findDescriptionOfEngine(other) + 26] ^= 1;
    built(await buildOnCarrier(folder, "other-form", other));
    const { stdout, stderr, exitCode } = await spawned([executablePath(folder, "out")], folder, bunEnv);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
    expect(stderr).toStartWith("error: can't run this executable's compiled code");
  },
  timeout,
);

test.each(Object.keys(identityRemovals))(
  "a Bun without an identity is rejected when the program is built: %s",
  async name => {
    if (!hasIdentity) return;
    using dir = tempDir("aot-carrier-unidentified", files);
    const folder = String(dir);
    const other = readFileSync(bunExe());
    identityRemovals[name]!(other, findIdentityOffset(other));
    const { stderr, exitCode } = await buildOnCarrier(folder, "no-identity", other);
    expect(stderr).toMatch(/^error: .*no-identity/m);
    expect(exitCode).toBe(1);
    expect(existsSync(executablePath(folder, "out"))).toBe(false);
  },
  timeout,
);

test(
  "an image moved into another Bun is rejected at start",
  async () => {
    using dir = tempDir("aot-carrier-moved", files);
    const folder = String(dir);
    const compiled = await build(folder, null);
    if (!hasIdentity) {
      expect(compiled.stderr).toMatch(/^error:/m);
      expect(compiled.exitCode).toBe(1);
      return;
    }
    built(compiled);

    const original = readFileSync(executablePath(folder, "out"));
    expectAnswer(await runCopy(folder, original, bunEnv));

    const moved = Buffer.from(original);
    flipIdentity(moved);
    expect(await runCopy(folder, moved, bunEnv)).toEqual({
      stdout: "",
      stderr:
        "error: can't run this executable's compiled code: it was built for a different build of Bun than the one in this executable. Rebuild it\n",
      exitCode: 1,
      signal: null,
    });
  },
  timeout,
);
