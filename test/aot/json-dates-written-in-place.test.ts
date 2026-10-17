// A Date in what JSON.stringify or Response.json is handed does not send the whole answer the slow way round: an executable built
// with --aot does not let a program alter Date.prototype, so a date that has nothing of its own is written where it stands.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
    if (process.argv[2] === "its own") {
      const date = new Date(7);
      Object.defineProperty(date, "toJSON", { value: () => "its own" });
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

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test("dates are written in place, and a date with a toJSON of its own is not", async () => {
  using dir = tempDir("aot-dates-in-json", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const whyGivenUp = async (argument: string, stdout: string) => {
    const path = join(String(dir), "counts-" + argument.replace(" ", "-"));
    const env = { ...bunEnv, BUN_JSC_useAOTOperationCounters: "1", BUN_JSC_aotTypeCoverageCountsPath: path };
    expect(await run([executable, argument], String(dir), env)).toEqual({ stdout, stderr: "", exitCode: 0 });
    const reasons: string[] = [];
    for (const line of existsSync(path + ".guests") ? readFileSync(path + ".guests", "utf8").split("\n") : []) {
      const [, kind, reason] = line.split("\t");
      if (kind === "JSON.stringify-fast-way-gives-up") reasons.push(reason);
    }
    return reasons.sort();
  };
  expect(
    await whyGivenUp(
      "all",
      '[true,true,"[null,\\"+275760-09-13T00:00:00.000Z\\",\\"-000001-12-31T23:59:59.999Z\\"]",true,true]\n',
    ),
  ).toEqual(["replacer"]);
  expect(await whyGivenUp("its own", '["{\\"date\\":\\"its own\\"}"]\n')).toEqual([
    "date that may have its own toJSON",
    "replacer",
  ]);
}, 240_000);
