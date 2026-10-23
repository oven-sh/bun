import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { built } from "./run-programs";
import { test } from "./supported-with-counted-calls";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] },
  }),
  "main.ts": `
    interface Point { x: number; y: number; label: string }
    const texts: Record<string, string> = {
      "ends with the value": '{"x":1,"y":2,"label":"a"}',
      "white space at the end": '{"x":1,"y":2,"label":"a"}\\n',
      "16-bit": '{"x":1,"y":2,"label":"\\u65e5"}',
    };
    function sumOf(text: string, rounds: number): number {
      let sum = 0;
      for (let round = 0; round < rounds; round++) {
        const point = JSON.parse(text) as Point;
        sum += point.x + point.y + point.label.length;
      }
      return sum;
    }
    console.log(sumOf(texts[process.argv[2]!]!, Number(process.argv[3])));
  `,
};

test("the run time is asked to close a parsed text only where it reads on or owns the original characters", async () => {
  using dir = tempDir("aot-json-parse-closes-texts", files);
  const cwd = String(dir);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  built(await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv));

  const closes = async (kind: string, rounds: number) => {
    const path = join(cwd, "counts");
    const env = { ...bunEnv, BUN_JSC_aotCountsPath: path };
    expect(await run([executable, kind, String(rounds)], cwd, env)).toEqual({
      stdout: rounds * 4 + "\n",
      stderr: "",
      exitCode: 0,
    });
    const entries = readFileSync(path, "utf8")
      .split("\n")
      .map(line => line.split("\t"));
    return entries
      .filter(([, name]) => name === "operation:operationAOTJSONSourceClose")
      .reduce((sum, [count]) => sum + Number(count), 0);
  };
  const closesOfThousandParses = async (kind: string) => (await closes(kind, 1100)) - (await closes(kind, 100));

  expect({
    "ends with the value": await closesOfThousandParses("ends with the value"),
    "white space at the end": await closesOfThousandParses("white space at the end"),
    "16-bit": await closesOfThousandParses("16-bit"),
  }).toEqual({ "ends with the value": 0, "white space at the end": 1000, "16-bit": 1000 });
}, 240_000);
