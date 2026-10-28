import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Every key is dropped as soon as it is stored, so the table needs no more room for sixteen million keys than for two.
const files = {
  "main.mjs": `
    const notes = new WeakMap();
    function churn(turns) {
      let sum = 0;
      for (let i = 0; i < turns; i++) {
        const key = {};
        notes.set(key, i);
        sum = (sum + notes.get(key)) | 0;
      }
      return sum;
    }
    churn(Number(process.argv[2]));
    console.log(process.resourceUsage().maxRSS);
  `,
};

test("the most memory a WeakMap of short-lived keys takes does not grow with the number of keys", async () => {
  using dir = tempDir("aot-weak-map-of-short-lived-keys", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const most: number[] = [];
  for (const turns of ["2000000", "16000000"]) {
    const ran = await run([executable, turns], String(dir));
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    most.push(Number(ran.stdout.trim()));
  }
  expect(most[1]! / most[0]!).toBeLessThan(2);
}, 240_000);
