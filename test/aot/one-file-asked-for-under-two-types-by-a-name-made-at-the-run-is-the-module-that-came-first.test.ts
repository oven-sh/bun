// `await import(name, { with: { type: "text" } })` and then `await import(name, { with: { type: "sqlite" } })` of one file: the loader keeps its modules under the
// resolved path and the class of the type, and `text` and `sqlite` are of one class, so the second import is answered with the module of the first. An executable
// answers alike where the name is made at the run. Each case runs under `bun` first, and the executable is started where it was built and where no source lies.
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const held = `if (process.argv.length > 99) await import("./ledger.sqlite", { with: { type: "sqlite" } });\nconst name = process.argv[2] ?? "./ledger.sqlite";\n`;
const ask = (type: string) => `(await import(name, { with: { type: ${JSON.stringify(type)} } })).default`;

const cases: Record<string, { main: string; prints: string }> = {
  "text first, then the database": {
    main: `${held}const first = ${ask("text")};\nconst second = ${ask("sqlite")};\nconsole.log(typeof first, typeof second, first === second);\n`,
    prints: "string string true\n",
  },
  "the database first, then text": {
    main: `${held}const first = ${ask("sqlite")};\nconst second = ${ask("text")};\nconsole.log(typeof first, typeof second, first === second);\n`,
    prints: "object object true\n",
  },
  "the database twice": {
    main: `${held}const first = ${ask("sqlite")};\nconst second = ${ask("sqlite")};\nconsole.log(typeof first, typeof second, first === second);\n`,
    prints: "object object true\n",
  },
  "the database alone": {
    main: `${held}console.log(${ask("sqlite")}.query("select sum from sums").get().sum);\n`,
    prints: "31\n",
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { main, prints } = cases[name];
  using sources = tempDir("aot-one-file-under-two-types", { "main.mjs": main });
  using elsewhere = tempDir("aot-one-file-under-two-types-elsewhere", {});
  using output = tempDir("aot-one-file-under-two-types-output", {});
  const database = new Database(join(String(sources), "ledger.sqlite"));
  database.exec("create table sums (sum integer)");
  database.query("insert into sums values (?)").run(31);
  database.close();
  copyFileSync(join(String(sources), "ledger.sqlite"), join(String(elsewhere), "ledger.sqlite"));
  const plain = await run([bunExe(), "main.mjs"], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
  const executable = join(String(output), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  for (const folder of [String(sources), String(elsewhere)]) {
    const compiled = await run([executable], folder, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
  }
});
