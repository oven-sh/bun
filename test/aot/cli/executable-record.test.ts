import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, test } from "../supported";
import { findImages, imageHeader } from "./compiled-image";
import { runCopy, type SpawnResult } from "./edited-executable";

type ExecutableRecord = ReturnType<typeof readRecord>;

const timeout = 300_000;
const hasCompiledProgram = 1 << 14;
const interpreterForbidden = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

const workerSource = (shared: string, word: string) => `import { load } from "${shared}";
declare var self: Worker;
function sum(n: number): number {
  let total = 0;
  for (let i = 1; i <= n; i++) total += i;
  return total;
}
self.onmessage = event => postMessage(\`${word} \${sum(event.data)} \${load()}\`);
`;

const files = {
  "shared.ts": `export let loads = 0;\nexport function load(): number {\n  return ++loads;\n}\n`,
  "worker.ts": workerSource("./shared", "worker"),
  nested: { "other.ts": workerSource("../shared", "other") },
  "main.ts": `import { load } from "./shared";
function ask(worker: Worker, n: number): Promise<string> {
  return new Promise(resolve => {
    worker.onmessage = event => {
      resolve(String(event.data));
      worker.terminate();
    };
    worker.postMessage(n);
  });
}
console.log(await ask(new Worker("./worker.ts"), 10));
console.log(await ask(new Worker(new URL("./nested/other.ts", import.meta.url).href), 11));
console.log("main " + load());
`,
};

let folder = "";
let expected: SpawnResult;
let original: Buffer;
let bundled: Buffer;
afterAll(() => {
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const executablePath = (directory: string, name: string) => join(directory, isWindows ? name + ".exe" : name);
const outcome = (ran: SpawnResult) => ({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal });

function expectRejected(ran: SpawnResult) {
  expect(outcome(ran)).toEqual({ stdout: "", exitCode: 1, signal: null });
  expect(ran.stderr).toMatch(/^error: /m);
  expect(ran.stderr).not.toMatch(/panic|Segmentation fault|has crashed/i);
}

function readRecord(file: Buffer) {
  const trailer = file.lastIndexOf("\n---- Bun! ----\n", undefined as any, "latin1");
  const offsets = trailer - 32;
  const byteCount = Number(file.readBigUInt64LE(offsets));
  const base = offsets - byteCount;
  const modules = { offset: file.readUInt32LE(offsets + 8), length: file.readUInt32LE(offsets + 12) };
  const flags = file.readUInt32LE(offsets + 28);
  const fileCount = modules.length / 52;
  let at = base + modules.offset + modules.length;
  if (flags & (1 << 5)) at += 4 * fileCount;
  if (flags & (1 << 6)) at += 4 + 12 * file.readUInt32LE(at);
  if (flags & (1 << 7)) at += 8;
  if (flags & (1 << 8)) at += 4;
  if (flags & (1 << 9)) at += 8;
  if (flags & (1 << 11)) at += 12 + 4 * file.readUInt32LE(at + 8);
  if (flags & (1 << 12)) at += 8;
  if (flags & (1 << 13)) at += 32;

  const image = { offset: file.readUInt32LE(at), length: file.readUInt32LE(at + 4) };
  const count = flags & hasCompiledProgram ? file.readUInt32LE(at + 8) : 0;
  const entries = Array.from({ length: count }, (_, i) => {
    const entry = at + 16 + 16 * i;
    return {
      at: entry,
      fileIndex: file.readUInt32LE(entry),
      moduleId: file.readUInt32LE(entry + 4),
      sourcePath: { offset: file.readUInt32LE(entry + 8), length: file.readUInt32LE(entry + 12) },
    };
  });
  return { base, byteCount, fileCount, flags, at, image, count, entries, orderAt: at + 16 + 16 * count };
}

const flagWithoutRecord = "the flag without the record";

const edits: Record<string, (file: Buffer, record: ExecutableRecord) => void> = {
  "more entry points than files": (file, { at, fileCount }) => file.writeUInt32LE(fileCount + 1, at + 8),
  "a count that overflows": (file, { at }) => file.writeUInt32LE(0xffffffff, at + 8),
  "the image starts past the payload": (file, { at }) => file.writeUInt32LE(0xfffff000, at),
  "the image ends past the payload": (file, { at, byteCount }) => file.writeUInt32LE(byteCount, at + 4),
  "an empty image": (file, { at }) => file.writeUInt32LE(0, at + 4),
  "the image is off its page": (file, { at, image }) => {
    file.writeUInt32LE(image.offset + 8, at);
    file.writeUInt32LE(image.length - 8, at + 4);
  },
  "a file index past the files": (file, { entries, fileCount }) => file.writeUInt32LE(fileCount, entries[0]!.at),
  "file indexes that descend": (file, { entries }) => {
    const first = Buffer.from(file.subarray(entries[0]!.at, entries[0]!.at + 16));
    file.copy(file, entries[0]!.at, entries[1]!.at, entries[1]!.at + 16);
    first.copy(file, entries[1]!.at);
  },
  "a source path past the payload": (file, { entries }) => file.writeUInt32LE(0xfffffff0, entries[0]!.at + 8),
  "a source path whose end wraps": (file, { entries }) => {
    file.writeUInt32LE(0xffffffff, entries[0]!.at + 8);
    file.writeUInt32LE(0xffffffff, entries[0]!.at + 12);
  },
  "an order entry past the entry points": (file, { orderAt }) => file.writeUInt32LE(3, orderAt),
  [flagWithoutRecord]: (file, { base, byteCount, flags }) =>
    file.writeUInt32LE(flags | hasCompiledProgram, base + byteCount + 28),
};

beforeAll(async () => {
  folder = String(tempDir("aot-executable-record", files));
  expected = await spawned([bunExe(), "run", "main.ts"], folder, bunEnv);
  expect(outcome(expected)).toEqual({ stdout: "worker 55 1\nother 66 1\nmain 1\n", exitCode: 0, signal: null });

  const entryPoints = ["main.ts", "worker.ts", "nested/other.ts"];
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), ...entryPoints, "--outfile", "program"],
      folder,
      bunEnv,
    ),
  );
  original = readFileSync(executablePath(folder, "program"));

  built(await spawned([bunExe(), "build", "--compile", ...entryPoints, "--outfile", "bundled"], folder, bunEnv));
  bundled = readFileSync(executablePath(folder, "bundled"));
}, timeout);

test(
  "several entry points and workers run as under bun run",
  async () => {
    for (const cwd of [folder, "/"]) {
      const ran = await spawned([executablePath(folder, "program")], cwd, interpreterForbidden);
      expect(outcome(ran)).toEqual(outcome(expected));
    }
  },
  timeout,
);

test(
  "the record names the image and each entry point",
  async () => {
    const { base, byteCount, fileCount, flags, image, count, entries, orderAt } = readRecord(original);
    expect(flags & hasCompiledProgram).not.toBe(0);
    expect(count).toBe(3);

    const fileIndexes = entries.map(entry => entry.fileIndex);
    expect(fileIndexes[0]!).toBeLessThan(fileIndexes[1]!);
    expect(fileIndexes[1]!).toBeLessThan(fileIndexes[2]!);
    expect(fileIndexes[2]!).toBeLessThan(fileCount);

    const sourcePaths = entries.map(({ sourcePath: { offset, length } }) =>
      original.latin1Slice(base + offset, base + offset + length).replaceAll("\\", "/"),
    );
    expect(sourcePaths.sort()).toEqual([
      expect.stringMatching(/\/main\.ts$/),
      expect.stringMatching(/\/nested\/other\.ts$/),
      expect.stringMatching(/\/worker\.ts$/),
    ]);

    const order = [0, 1, 2].map(i => original.readUInt32LE(orderAt + 4 * i));
    expect(order.sort()).toEqual([0, 1, 2]);
    expect(orderAt + 12).toBeLessThanOrEqual(base + byteCount);

    const imageAt = base + image.offset;
    expect((8 + image.offset) % 4096).toBe(0);
    // The main program starts Workers, so each entry point begins a program of its own. Their images lie one behind the other.
    const starts: number[] = [];
    let end = imageAt;
    for (const _ of entries) {
      starts.push(end);
      end += Number(original.readBigUInt64LE(end + imageHeader.size));
    }
    expect(findImages(original)).toEqual(starts);
    expect(image.length).toBe(end - imageAt);

    expect(readRecord(bundled).flags & hasCompiledProgram).toBe(0);
    const ran = await spawned([executablePath(folder, "bundled")], folder, bunEnv);
    expect(outcome(ran)).toEqual(outcome(expected));
  },
  timeout,
);

test.each(Object.keys(edits))(
  "a record with bad bytes is an error at start: %s",
  async name => {
    const copy = Buffer.from(name === flagWithoutRecord ? bundled : original);
    edits[name]!(copy, readRecord(copy));
    expectRejected(await runCopy(folder, copy, bunEnv));
  },
  timeout,
);

test(
  "an unedited copy of the executable runs",
  async () => {
    const ran = await runCopy(folder, original, interpreterForbidden);
    expect(outcome(ran)).toEqual(outcome(expected));
  },
  timeout,
);
