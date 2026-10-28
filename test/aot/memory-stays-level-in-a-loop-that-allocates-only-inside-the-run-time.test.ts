import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.ts": `
    class Plain {
      id = 1;
    }
    class Stamped extends Plain {
      stamp = 7;
    }
    class Counting {
      id: number;
      constructor() {
        this.id = arguments.length + 1;
      }
    }
    class CountingBelow extends Counting {
      stamp = 7;
    }
    class Sealed {
      #code = 3;
      static read(value: any): number {
        return value.#code;
      }
    }
    const none: any[] = [];
    const kept: any[] = [];
    const notFunctions: any[] = [1, 2, 3, 4];
    const stranger = {};

    const loops: Record<string, (turns: number) => number> = {
      "a base class constructed for a class below it"(turns) {
        let sum = 0;
        for (let i = 0; i < turns; i++) {
          const value = Reflect.construct(Plain, none, Stamped);
          kept[i & 7] = value;
          sum = (sum + value.id) | 0;
        }
        return sum;
      },
      "a base class that counts its arguments"(turns) {
        let sum = 0;
        for (let i = 0; i < turns; i++) {
          const value = new CountingBelow();
          kept[i & 7] = value;
          sum = (sum + value.id + value.stamp) | 0;
        }
        return sum;
      },
      "a caught call of what is no function"(turns) {
        let sum = 0;
        for (let i = 0; i < turns >> 2; i++) {
          try {
            sum += notFunctions[i & 3]();
          } catch {
            sum++;
          }
        }
        return sum;
      },
      "a caught read of a private name that the object lacks"(turns) {
        let sum = 0;
        for (let i = 0; i < turns >> 2; i++) {
          try {
            sum += Sealed.read(stranger);
          } catch {
            sum++;
          }
        }
        return sum;
      },
    };

    const loop = loops[process.argv[2]];
    loop(100_000);
    const before = process.memoryUsage.rss();
    const sum = loop(1_600_000);
    console.log(sum, Math.round((process.memoryUsage.rss() - before) / (1024 * 1024)));
  `,
};

test.skipIf(isASAN || isDebug)(
  "the collector runs although every block of cells comes to its end inside an operation that puts collection off",
  async () => {
    using dir = tempDir("aot-memory-stays-level", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], String(dir));
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const sums = {
      "a base class constructed for a class below it": 1_600_000,
      "a base class that counts its arguments": 12_800_000,
      "a caught call of what is no function": 400_000,
      "a caught read of a private name that the object lacks": 400_000,
    };
    for (const [name, sum] of Object.entries(sums)) {
      const ran = await run([executable, name], String(dir));
      const [printedSum, megabytesMore] = ran.stdout.trim().split(" ").map(Number);
      expect({
        name,
        stderr: ran.stderr,
        exitCode: ran.exitCode,
        sum: printedSum,
        staysLevel: megabytesMore < 24,
      }).toEqual({
        name,
        stderr: "",
        exitCode: 0,
        sum,
        staysLevel: true,
      });
    }
  },
  240_000,
);
