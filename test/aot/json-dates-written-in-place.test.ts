import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { built } from "./run-programs";
import { test } from "./supported";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] },
  }),
  "main.ts": `
    interface Comment { id: number; at: Date; replies: Comment[] }
    const comment = (id: number, depth: number): Comment => ({ id, at: new Date(1_700_000_000_000 + id * 86_400_123), replies: depth ? [comment(id * 2 + 1, depth - 1), comment(id * 2 + 2, depth - 1)] : [] });
    const typed = comment(1, 3);
    const expected = JSON.stringify(typed, (key, value) => value);
    const plain: unknown = JSON.parse(expected, (key, value) => (key === "at" ? new Date(value) : value));
    const written = (value: unknown) => JSON.stringify(value);
    const answers: unknown[] = [];
    if (process.argv[2] === "own toJSON") {
      const date = new Date(7);
      Object.defineProperty(date, "toJSON", { value: () => "own toJSON" });
      answers.push(written(JSON.parse('{"date":0}', (key, value) => (key === "date" ? date : value))));
    } else {
      for (let round = 0; round < 50; round++) answers[0] = written(plain) === expected;
      for (let round = 0; round < 50; round++) answers[1] = written(typed) === expected;
      for (let round = 0; round < 50; round++) answers[2] = written([new Date(NaN), new Date(8.64e15), new Date(-62_167_219_200_001)]);
      answers[3] = (await Response.json(plain).text()) === expected;
      answers[4] = JSON.stringify(plain, null, 1) === JSON.stringify(JSON.parse(expected), null, 1);
    }
    console.log(JSON.stringify(answers));
    Bun.gc(true);
  `,
};

const callsWithReplacer = 1;

test("JSON.stringify takes the slow path for a date with its own toJSON and for no other date", async () => {
  using dir = tempDir("aot-dates-in-json", files);
  const cwd = String(dir);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  built(await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv));

  const slowPathCounts = async (argument: string, stdout: string) => {
    const path = join(cwd, "counts-" + argument.replace(" ", "-"));
    const env = { ...bunEnv, BUN_JSC_aotCountsPath: path };
    expect(await run([executable, argument], cwd, env)).toEqual({ stdout, stderr: "", exitCode: 0 });
    const entries = readFileSync(path, "utf8")
      .split("\n")
      .map(line => line.split("\t"));
    return entries.filter(([, name]) => name === "counter:JSONStringifySlowPaths").map(([count]) => Number(count));
  };

  expect(
    await slowPathCounts(
      "builtin toJSON",
      '[true,true,"[null,\\"+275760-09-13T00:00:00.000Z\\",\\"-000001-12-31T23:59:59.999Z\\"]",true,true]\n',
    ),
  ).toEqual([callsWithReplacer]);
  expect(await slowPathCounts("own toJSON", '["{\\"date\\":\\"own toJSON\\"}"]\n')).toEqual([callsWithReplacer + 1]);
}, 240_000);
