import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { withoutCoreDump } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

setDefaultTimeout(120_000);

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

  async function build(flags: string[], outfile: string) {
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, "main.ts", "--outfile", outfile],
      cwd,
      bunEnv,
    );
    expect(built.stderr).not.toMatch(/^error\b/m);
    expect(built.exitCode).toBe(0);
  }

  beforeAll(async () => {
    folder = tempDir("aot-cell-cage-messages", { "main.ts": `console.log("ran");\n` });
    cwd = String(folder);
    narrow = join(cwd, isWindows ? "narrow.exe" : "narrow");
    wide = join(cwd, isWindows ? "wide.exe" : "wide");
    await Promise.all([build([], narrow), build(["--aot-huge-heap"], wide)]);
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

  test("blocks outside cage", async () => {
    expect(await run([narrow], cwd, cageSize("1"))).toEqual(
      exitsWith(
        "error: the objects created before this executable's code was loaded don't fit in BUN_JSC_markedBlockCageSizeInMB=1. Raise it, or build with --aot-huge-heap.\n",
      ),
    );
  });

  test.skipIf(!isLinux || isASAN || isDebug)("reservation failure", async () => {
    expect(await run(["sh", "-c", 'ulimit -v 300000 && exec "$0"', narrow], cwd, cageSize(undefined))).toEqual({
      stdout: "",
      stderr: expect.stringMatching(
        /^error: this executable needs 64 MB of address space for its JavaScript heap, and the limit on address space \(ulimit -v\) leaves \d+ MB for it\. Raise the limit, or build with --aot-huge-heap\.\n/,
      ),
      exitCode: 1,
      signalCode: null,
    });
  });

  test.skipIf(!isLinux || isASAN || isDebug).each([2_000_000, 1_000_000, 500_000])(
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
