// ./run-parallel.ts builds every stored program alone as well, at default flags and under the compiler's checks, and holds each such build against plain Bun.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

async function verdictOf(text: string, flags: string[] = [], day = 10) {
  using dir = tempDir("aot-alone-under-checks", { "tsconfig.json": "{}", "program.ts": text });
  const root = String(dir);
  const { stdout, stderr } = await run(
    [
      bunExe(),
      join(import.meta.dir, "run-parallel.ts"),
      `--root=${root}`,
      "--jobs=2",
      ...flags,
      join(root, "program.ts"),
    ],
    root,
    { ...bunEnv, AOT_DAY: String(day), AOT_CHECKS_AT_RUN_TIME: "0" },
  );
  const verdicts = stdout
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(({ state }) => state !== "compiling");
  expect(verdicts.length).toBe(1);
  const [{ state, stage, message, ways }] = verdicts;
  return { state, stage, message, ways, saysTheDay: stderr.includes(`AOT_DAY=${day} takes the same part`) };
}

const passes = `console.log(String(1 + Number(process.argv.length > 99)));\n`;
// ./sabotages.test.ts: with this word the program prints something else.
const sabotage = "--aot-sabotage=CarriedVariablesAreWrittenByOthers";
const noticesIt = readFileSync(
  join(import.meta.dir, "parallel", "pass-conditions", "carried-variable-do-while.ts"),
  "utf8",
)
  // It is built alone anyway, and then its first build is the build alone.
  .replace(/^\/\/ Alone: .*\n/, "");

test("a program is built alone, and alone under --aot-validate", async () => {
  expect(await verdictOf(passes)).toMatchObject({
    state: "pass",
    ways: { compiled: "pass", erased: "pass", alone: "pass", "alone under --aot-validate": "pass" },
    saysTheDay: true,
  });
});

test("under another check on one day in ten", async () => {
  const check = "--aot-check=verify-each-pass";
  const drawnOn = 20 - Number(BigInt(Bun.hash(`program.ts ${check}`)) % 10n);
  expect((await verdictOf(passes, [], drawnOn)).ways).toHaveProperty([`alone under ${check}`], "pass");
  expect((await verdictOf(passes, [], drawnOn + 1)).ways).not.toHaveProperty([`alone under ${check}`]);
});

test("--no-erased and --no-alone leave those builds out", async () => {
  expect((await verdictOf(passes, ["--no-erased"])).ways).toEqual({ compiled: "pass" });
  expect((await verdictOf(passes, ["--no-alone"])).ways).toEqual({ compiled: "pass", erased: "pass" });
});

test("a build alone that prints something else fails the program", async () => {
  expect(await verdictOf(noticesIt, [`--alone-under=${sabotage}`])).toMatchObject({
    state: "fail",
    stage: "compare",
    message: `alone under ${sabotage}: it does not exit and print as plain Bun does`,
    ways: { compiled: "pass", erased: "pass", [`alone under ${sabotage}`]: "fail" },
  });
});

test("a program may say that a build alone does not pass today, as long as that is so", async () => {
  expect(
    await verdictOf(`// Todo alone under ${sabotage}: shown here\n${noticesIt}`, [`--alone-under=${sabotage}`]),
  ).toMatchObject({ state: "pass", ways: { compiled: "pass", erased: "pass", [`alone under ${sabotage}`]: "todo" } });
  expect(
    await verdictOf(`// Todo alone under a check: shown here\n${noticesIt}`, [`--alone-under=${sabotage}`]),
  ).toMatchObject({ state: "pass", ways: { [`alone under ${sabotage}`]: "todo" } });
  expect(await verdictOf(`// Todo alone: shown here\n${passes}`, ["--alone-under="])).toMatchObject({
    state: "fail",
    stage: "todo",
    message: "alone: it passes: its `// Todo alone ..:` line goes out",
  });
});

test("--checks-at-run-time holds the second run against the first", async () => {
  const tellsThemApart = `console.log(process.env.BUN_JSC_validateAOTRuntime ?? "off");\n`;
  expect(await verdictOf(tellsThemApart, ["--no-erased"])).toMatchObject({ state: "pass" });
  expect(await verdictOf(tellsThemApart, ["--no-erased", "--checks-at-run-time"])).toMatchObject({
    state: "fail",
    stage: "checks",
    message: "with the checks of the run time on it does not exit and print as without them",
  });
});
