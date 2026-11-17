// `await import(flag ? "./NOTICE" : "./LICENSE", { with: { type: "text" } })`: the names are written out and the call says what the files are, so they are in the
// executable though they have no ending. Each case prints what `bun <the main file>` prints. The executable is started in an empty folder.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const texts = { LICENSE: "the license\n", NOTICE: "the notice\n" };
const choice = `process.argv.length > 99 ? "./NOTICE" : "./LICENSE"`;
const show = (load: string) =>
  `const got = ${load};\nconsole.log(typeof got === "string" ? got.trim() : JSON.stringify(got));\n`;

type Case = { text: string; files: Record<string, string>; prints: string };
const cases: Record<string, Case> = {
  "a written name": {
    text: show(`(await import("./LICENSE", { with: { type: "text" } })).default`),
    files: texts,
    prints: "the license\n",
  },
  "a choice as text": {
    text: show(`(await import(${choice}, { with: { type: "text" } })).default`),
    files: texts,
    prints: "the license\n",
  },
  "the other arm is taken": {
    text: show(
      `(await import(process.argv.length < 99 ? "./NOTICE" : "./LICENSE", { with: { type: "text" } })).default`,
    ),
    files: texts,
    prints: "the notice\n",
  },
  "one of the names has an ending": {
    text: show(
      `(await import(process.argv.length > 99 ? "./notes.txt" : "./LICENSE", { with: { type: "text" } })).default`,
    ),
    files: { ...texts, "notes.txt": "the notes\n" },
    prints: "the license\n",
  },
  "a choice as JSON": {
    text: show(`(await import(process.argv.length > 99 ? "./other" : "./config", { with: { type: "json" } })).default`),
    files: { config: `{ "n": 1 }\n`, other: `{ "n": 2 }\n` },
    prints: `{"n":1}\n`,
  },
  "a choice as a file": {
    text: show(`typeof (await import(${choice}, { with: { type: "file" } })).default`),
    files: texts,
    prints: "string\n",
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { text, files, prints } = cases[name];
  using sources = tempDir("aot-a-written-alternative-without-an-ending", { ...files, "main.mjs": text });
  using elsewhere = tempDir("aot-a-written-alternative-without-an-ending-run", {});
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.mjs"], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], String(elsewhere), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
});
