import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Numbers of two lengths are made in turns, so their blocks lie in turns too, and then those of one length are dropped.
const files = {
  "main.ts": `
    import { readFileSync } from "node:fs";

    function countMappings(): number {
      return readFileSync("/proc/self/maps", "utf8").split("\\n").length - 1;
    }

    function fill(turns: number): bigint[][] {
      let short = 1n << 2000n;
      let long = 1n << 4000n;
      const shorts: bigint[] = new Array(2 * turns);
      const longs: bigint[] = new Array(turns);
      for (let i = 0; i < turns; i++) {
        shorts[2 * i] = short += 1n;
        shorts[2 * i + 1] = short += 1n;
        longs[i] = long += 1n;
      }
      return [shorts, longs];
    }

    const lists = fill(500_000);
    lists[0] = [];
    let most = 0;
    for (let i = 0; i < 10; i++) {
      Bun.gc(true);
      await new Promise(resolve => setTimeout(resolve, 100));
      most = Math.max(most, countMappings());
    }
    console.log(most + " " + lists[1].length);
  `,
};

// With Malloc set, the range that holds the cells hands out its blocks itself and takes the access away from a freed one.
test.skipIf(!isLinux)(
  "the range that holds the cells is split into a bounded number of mappings",
  async () => {
    using dir = tempDir("aot-blocks-freed-between-live-ones", files);
    const executable = join(String(dir), "main");
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], String(dir));
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const ran = await run([executable], String(dir), { ...bunEnv, Malloc: "1" });
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const [most, kept] = ran.stdout.trim().split(" ").map(Number);
    expect(kept).toBe(500_000);
    expect(most).toBeLessThan(20_000);
  },
  240_000,
);
