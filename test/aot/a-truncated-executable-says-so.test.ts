import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { copyFileSync, readFileSync, realpathSync, truncateSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { test } from "./supported";

// The check needs MADV_POPULATE_READ (Linux 5.14).
const [kernelMajor, kernelMinor] = release().split(".").map(Number);
const reportsTruncation = isLinux && (kernelMajor > 5 || (kernelMajor === 5 && kernelMinor >= 14));

function pageSize(): number {
  // Pairs of u64: a type, then its value.
  const auxiliaryVector = readFileSync("/proc/self/auxv");
  const AT_PAGESZ = 6n;
  for (let at = 0; at + 16 <= auxiliaryVector.length; at += 16) {
    if (auxiliaryVector.readBigUInt64LE(at) === AT_PAGESZ) return Number(auxiliaryVector.readBigUInt64LE(at + 8));
  }
  throw new Error("no AT_PAGESZ");
}

/** Where `[u64 length][payload]` lies in the file: the section ".bun". */
function findPayload(path: string) {
  const file = readFileSync(path);
  const [sectionsAt, sectionSize, sectionCount, namesIndex] = [
    Number(file.readBigUInt64LE(40)),
    file.readUInt16LE(58),
    file.readUInt16LE(60),
    file.readUInt16LE(62),
  ];
  const namesAt = Number(file.readBigUInt64LE(sectionsAt + namesIndex * sectionSize + 24));
  for (let at = sectionsAt; at < sectionsAt + sectionSize * sectionCount; at += sectionSize) {
    const nameAt = namesAt + file.readUInt32LE(at);
    if (file.toString("latin1", nameAt, nameAt + 5) !== ".bun\0") continue;
    const start = Number(file.readBigUInt64LE(at + 24));
    return { start, end: start + 8 + Number(file.readBigUInt64LE(start)) };
  }
  throw new Error("no section .bun");
}

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.if(reportsTruncation)(
  "a truncated executable says so unless part of the payload's last page is left",
  async () => {
    using folder = tempDir("aot-truncated-executable", {
      "big.txt": Buffer.alloc(1024 * 1024, "x").toString(),
      "main.ts": `import big from "./big.txt" with { type: "text" };
function add(a: number, b: number): number {
  return a + b;
}
console.log("intact-" + add(big.length, 0));
`,
    });
    const cwd = String(folder);
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "main"], cwd);
    expect(built.stderr).not.toMatch(/^error\b/m);
    expect(built.exitCode).toBe(0);

    const { start, end } = findPayload(join(cwd, "main"));
    const lastPage = end - 1 - ((end - 1) % pageSize());
    const lengths = [
      end,
      end - 1,
      // Inside the trailer, and inside the offsets before it.
      end - 8,
      end - 32,
      lastPage + 1,
      lastPage,
      ...Array.from({ length: 7 }, (_, eighth) => start + 8 + Math.floor(((end - start - 8) * (eighth + 1)) / 8)),
      start + pageSize(),
      start + 8,
      // Inside the length. What is left of it still holds every nonzero byte.
      start + 4,
      start,
    ].sort((a, b) => b - a);

    // Every length is shorter than the one before it, so one copy is enough.
    const cut = join(cwd, "main-cut");
    copyFileSync(join(cwd, "main"), cut);
    // At exit, LeakSanitizer would scan mapped pages that are past the end of the file.
    const ASAN_OPTIONS = [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":");
    const sentence = (what: string) => ({
      stdout: "",
      stderr:
        `error: "${realpathSync(cut)}" ${what}\n` +
        "note: The download or copy was probably interrupted. Download or install it again.\n",
      exitCode: 1,
      signalCode: null,
    });
    const says = sentence("is truncated. Part of its embedded program is missing.");
    const saysDamaged = sentence("is damaged. Its embedded program can't be read.");
    /** `result`: of a file in which no program is found. */
    const expectNoProgram = (label: object, result: Awaited<ReturnType<typeof run>>) => {
      // An executable without Bun's command line can run nothing but its program.
      if (canTrim) expect({ ...label, ...result }).toEqual({ ...label, ...saysDamaged });
      expect({ ...label, signalCode: result.signalCode }).toEqual({ ...label, signalCode: null });
      expect(result.stdout).not.toContain("intact");
    };
    for (const length of lengths) {
      truncateSync(cut, length);
      const payloadBytesLeft = length - start;
      const result = await run([cut], cwd, { ...bunEnv, BUN_BE_BUN: undefined, ASAN_OPTIONS });
      if (length >= end) {
        expect({ payloadBytesLeft, ...result }).toEqual({
          payloadBytesLeft,
          stdout: "intact-1048576\n",
          stderr: "",
          exitCode: 0,
          signalCode: null,
        });
      } else if (length > lastPage) {
        // The rest of the page reads as zeros, so there's no trailer.
        expectNoProgram({ payloadBytesLeft }, result);
      } else {
        expect({ payloadBytesLeft, ...result }).toEqual({ payloadBytesLeft, ...says });
      }
    }

    // A length at whose end there is no trailer.
    const whole = readFileSync(join(cwd, "main"));
    for (const payloadLength of [0, 7, end - start - 8 - 16, 2 ** 40]) {
      whole.writeBigUInt64LE(BigInt(payloadLength), start);
      writeFileSync(cut, whole);
      expectNoProgram({ payloadLength }, await run([cut], cwd, { ...bunEnv, BUN_BE_BUN: undefined, ASAN_OPTIONS }));
    }
    truncateSync(cut, start);

    // Within a limit on address space that is too small for the whole executable to start.
    if (!isASAN && !isDebug) {
      const limited = (path: string) =>
        run(
          ["sh", "-c", `ulimit -v ${kilobytesMappedFromFile(join(cwd, "main")) + 48 * 1024} && exec "$0"`, path],
          cwd,
          {
            ...bunEnv,
            BUN_BE_BUN: undefined,
          },
        );
      expect(await limited(join(cwd, "main"))).toEqual({
        stdout: "",
        stderr: expect.stringContaining("of address space to start"),
        exitCode: 1,
        signalCode: null,
      });
      expect(await limited(cut)).toEqual(says);
    }
  },
  120_000,
);

/** What the system maps of an ELF file before the first instruction runs. */
function kilobytesMappedFromFile(path: string) {
  const file = readFileSync(path);
  const [headersAt, headerSize, headerCount] = [
    Number(file.readBigUInt64LE(32)),
    file.readUInt16LE(54),
    file.readUInt16LE(56),
  ];
  let bytes = 0;
  for (let at = headersAt; at < headersAt + headerSize * headerCount; at += headerSize) {
    const isLoaded = 1;
    if (file.readUInt32LE(at) === isLoaded) bytes += Number(file.readBigUInt64LE(at + 40));
  }
  return Math.ceil(bytes / 1024);
}
