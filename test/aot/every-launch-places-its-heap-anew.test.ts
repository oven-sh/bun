import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { unsupported } from "./run-programs";

const program = `
  import { jscDescribe } from "bun:jsc";
  import { isMainThread } from "worker_threads";

  const text = jscDescribe({});
  console.log((isMainThread ? "first thread " : "worker ") + (BigInt(/Object: (0x[0-9a-f]+)/i.exec(text)![1]) >> 35n));
  if (isMainThread) console.log("structures " + (BigInt(/Structure (0x[0-9a-f]+)/i.exec(text)![1]) >> 32n));
  if (isMainThread) new Worker(new URL(import.meta.url));
`;
const launches = 6;
const rangesInFourTerabytes = 128;

test.skipIf(!!unsupported)(
  "every launch places its heaps anew",
  async () => {
    using dir = tempDir("aot-every-launch-places-its-heap-anew", { "program.ts": program });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "program.ts", "--outfile", "program"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });

    const ranges: Record<string, number[]> = { "first thread": [], "worker": [] };
    const structures = new Set<string>();
    for (let launch = 0; launch < launches; launch++) {
      await using proc = Bun.spawn({
        cmd: [join(String(dir), isWindows ? "program.exe" : "program")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: expect.stringMatching(/^first thread \d+\nstructures \d+\nworker \d+\n$/),
        stderr: "",
        exitCode: 0,
      });
      for (const [, what, range] of stdout.matchAll(/^(.+) (\d+)$/gm))
        what === "structures" ? structures.add(range) : ranges[what].push(Number(range));
    }

    const seen = Object.entries(ranges).map(([thread, of]) => ({
      thread,
      of,
      different: new Set(of).size >= launches - 1,
      farApart: Math.max(...of) - Math.min(...of) > rangesInFourTerabytes,
    }));
    expect(seen).toEqual(seen.map(row => ({ ...row, different: true, farApart: true })));
    expect(structures.size).toBeGreaterThan(1);
  },
  300_000,
);
