import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { withoutCoreDump } from "./harness/commands";
import { beforeAll, describe, test } from "./supported";

setDefaultTimeout(120_000);

const canLimitAddressSpace = isLinux && !isASAN && !isDebug;
const cageSize = (size: string | undefined) => ({ ...bunEnv, BUN_JSC_markedBlockCageSizeInMB: size });

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({
    cmd: withoutCoreDump(cmd),
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The engine prints through C's stderr, which ends a line with \r\n on Windows.
  return { stdout, stderr: stderr.replaceAll("\r\n", "\n"), exitCode, signalCode: proc.signalCode };
}

/** What the system maps of an ELF file before the first instruction runs. */
async function kilobytesMappedFromFile(path: string) {
  const header = new DataView(await Bun.file(path).slice(0, 64).arrayBuffer());
  const [offset, size, count] = [
    Number(header.getBigUint64(32, true)),
    header.getUint16(54, true),
    header.getUint16(56, true),
  ];
  const segments = new DataView(
    await Bun.file(path)
      .slice(offset, offset + size * count)
      .arrayBuffer(),
  );
  const isLoaded = 1;
  let bytes = 0;
  for (let at = 0; at < size * count; at += size)
    if (segments.getUint32(at, true) === isLoaded) bytes += Number(segments.getBigUint64(at + 40, true));
  return Math.ceil(bytes / 1024);
}

const printsProgramOutput = { stdout: "ran\n", stderr: "", exitCode: 0, signalCode: null };
const exitsWith = (message: string) => ({
  stdout: "",
  stderr: expect.stringContaining(message),
  exitCode: 1,
  signalCode: null,
});

describe("cell cage messages", () => {
  let folder: ReturnType<typeof tempDir> | undefined;
  let cwd: string;
  let narrow: string;
  let wide: string;

  async function build(flags: string[], outfile: string, entry = "main.ts") {
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", outfile],
      cwd,
      bunEnv,
    );
    expect(built.stderr).not.toMatch(/^error\b/m);
    expect(built.exitCode).toBe(0);
  }

  beforeAll(async () => {
    folder = tempDir("aot-cell-cage-messages", {
      "main.ts": `console.log("ran");\n`,
      "server.ts": `
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ran") });
console.log(await (await fetch(server.url)).text());
await server.stop(true);
`,
    });
    cwd = String(folder);
    narrow = join(cwd, isWindows ? "narrow.exe" : "narrow");
    wide = join(cwd, isWindows ? "wide.exe" : "wide");
    await Promise.all([
      build([], narrow),
      build(["--aot-huge-heap"], wide),
      canLimitAddressSpace && build([], join(cwd, "server"), "server.ts"),
    ]);
  });
  afterAll(() => folder?.[Symbol.dispose]());

  test("invalid size", async () => {
    expect(await run([narrow], cwd, cageSize("3"))).toEqual(
      exitsWith("markedBlockCageSizeInMB is not 0 or a power of two of at most 32768: 3\n"),
    );
  });

  test("no cage for 32-bit references", async () => {
    const result = await run([narrow], cwd, cageSize("0"));
    expect(result).toEqual(
      exitsWith(
        "error: this executable can't run with BUN_JSC_markedBlockCageSizeInMB=0. Build it with --aot-huge-heap to run it without a heap limit.\n",
      ),
    );
    expect(result.stderr).not.toContain("cannot be used");
  });

  // The first 16 MB of the cage are left unused: one that is no larger has room for no object.
  test.each(["1", "16"])("blocks outside a cage of %s MB", async size => {
    expect(await run([narrow], cwd, cageSize(size))).toEqual(
      exitsWith(
        `error: the objects created before this executable's code was loaded don't fit in BUN_JSC_markedBlockCageSizeInMB=${size}. Raise it, or build with --aot-huge-heap.\n`,
      ),
    );
  });

  const runWithin = (limitInKB: number, executable: string) =>
    run(["sh", "-c", `ulimit -v ${limitInKB} && exec "$0"`, executable], cwd, cageSize(undefined));

  describe.skipIf(!canLimitAddressSpace).each(["narrow", "wide", "server"])(
    "%s within a limit on address space",
    name => {
      const MB = 1024;
      const whatItNeeds =
        /^error: this executable needs (\d+) MB of address space to start, and the limit on address space \(ulimit -v\) leaves (\d+) MB\. Raise the limit\.\n$/;
      const saysWhatItNeeds = { stdout: "", stderr: expect.stringMatching(whatItNeeds), exitCode: 1, signalCode: null };

      test("says what it needs where less is left than the heap takes", async () => {
        const executable = join(cwd, name);
        expect(await runWithin((await kilobytesMappedFromFile(executable)) + 48 * MB, executable)).toEqual(
          saysWhatItNeeds,
        );
      });

      test("runs from the limit that leaves what it needs", async () => {
        const executable = join(cwd, name);
        const tooLittle = (await kilobytesMappedFromFile(executable)) + 48 * MB;
        const [, needed, left] = (await runWithin(tooLittle, executable)).stderr.match(whatItNeeds)!;
        const enough = tooLittle + (Number(needed) - Number(left)) * MB;
        const below = [32, 24, 16, 8, 4, 2].map(less => enough - less * MB);
        // The allocator reserves 128 MB or 1 GB at once where that leaves enough.
        const above = [1, 2, 4, 8, 16, 32, 64, 96, 120, 128, 136, 160, 256, 512, 1000, 1024, 1032, 1100].map(
          more => enough + more * MB,
        );
        expect(await Promise.all(below.map(limit => runWithin(limit, executable)))).toEqual(
          below.map(() => saysWhatItNeeds),
        );
        expect(await Promise.all(above.map(limit => runWithin(limit, executable)))).toEqual(
          above.map(() => printsProgramOutput),
        );
      });
    },
  );

  test.skipIf(!canLimitAddressSpace).each([2_000_000, 1_000_000, 500_000])(
    "narrow references run under a limit of %d kB on address space",
    async limit => {
      expect(await run(["sh", "-c", `ulimit -v ${limit} && exec "$0"`, narrow], cwd, cageSize(undefined))).toEqual(
        printsProgramOutput,
      );
    },
  );

  test.each(["0", "1", "64"])("wide references run with cage size %s", async size => {
    expect(await run([wide], cwd, cageSize(size))).toEqual(printsProgramOutput);
  });

  test("narrow references run with the default cage size", async () => {
    expect(await run([narrow], cwd, cageSize(undefined))).toEqual(printsProgramOutput);
  });

  test("bun run ignores an invalid cage size", async () => {
    expect(await run([bunExe(), "run", "main.ts"], cwd, cageSize("3"))).toEqual(printsProgramOutput);
  });
});

const deepName = "descend".repeat(80);
const crashFiles = {
  "ffi.d.ts": `declare module "bun:ffi" {
  export const read: { u8(pointer: number, offset: number): number };
}
`,
  "app.ts": `
import { read } from "bun:ffi";
function ${deepName}(depth: number): number {
  if (depth === 0) return read.u8(8, 0);
  return ${deepName}(depth - 1) + 1;
}
console.log(${deepName}(200));
`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      types: [],
      lib: ["esnext", "dom"],
    },
  }),
};

test.skipIf(isASAN)("crash report of compiled frames ends with a complete line when its buffer overflows", async () => {
  using folder = tempDir("aot-cell-cage-crash", crashFiles);
  const cwd = String(folder);
  const built = await run([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], cwd, bunEnv);
  expect(built.stderr).not.toContain("error");
  expect(built.exitCode).toBe(0);

  const { stderr } = await run([join(cwd, "app")], cwd, {
    ...bunEnv,
    BUN_CRASH_REPORT_URL: "",
    BUN_ENABLE_CRASH_REPORTING: "0",
  });
  const header = "Compiled JavaScript on the stack:\n";
  const start = stderr.indexOf(header);
  expect(start).toBeGreaterThan(-1);
  const section = stderr.slice(start + header.length);
  const end = section.indexOf("\n\n");
  expect(end).toBeGreaterThan(-1);
  const frames = section.slice(0, end).split("\n");
  const frameBytes = frames.reduce((total, frame) => total + Buffer.byteLength(frame) + 1, 0);
  expect(frameBytes).toBeLessThanOrEqual(4096);
  expect(frameBytes + Buffer.byteLength(frames[0]) + 1).toBeGreaterThan(4096);
  for (const frame of frames)
    expect(frame).toMatch(
      new RegExp(
        `^    at ${deepName} \\(${isWindows ? "B:\\\\~BUN\\\\root\\\\" : "/\\$bunfs/root/"}app\\.ts:\\d+:\\d+\\)$`,
      ),
    );
});
