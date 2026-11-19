// `await import(flag ? "./other.sqlite" : "./data.sqlite", { with: { type: "sqlite" } })`: a database that is not embedded is opened where the program runs,
// under the name as the program writes it, as an executable of `bun build --compile` opens it. Each case is built in one folder and started there, in a second
// folder that holds a database of its own, and in a third that holds none.
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const sqlite = `{ with: { type: "sqlite" } }`;
const place = `query("select place from places").get().place`;
const choose = (name: string) => `process.argv.length > 99 ? "./other.sqlite" : ${JSON.stringify(name)}`;

function createDatabase(folder: string, place: string) {
  const database = new Database(join(folder, "data.sqlite"));
  database.exec("create table places (place text)");
  database.query("insert into places values (?)").run(place);
  database.close();
}

type Case = { main: (sources: string) => string; prints: (place: string) => string };
const cases: Record<string, Case> = {
  "a written name": {
    main: () => `const { default: db } = await import("./data.sqlite", ${sqlite});\nconsole.log(db.${place});\n`,
    prints: place => `${place}\n`,
  },
  "a choice of names": {
    main: () =>
      `const { default: db } = await import(${choose("./data.sqlite")}, ${sqlite});\nconsole.log(db.${place});\n`,
    prints: place => `${place}\n`,
  },
  "a name with a hole": {
    main: () =>
      `const name = JSON.parse('"data"');\nconst { default: db } = await import(\`./\${name}.sqlite\`, ${sqlite});\nconsole.log(db.${place});\n`,
    prints: place => `${place}\n`,
  },
  "a chosen name that is not normal": {
    main: () =>
      `const { default: db } = await import(${choose("./sub/../data.sqlite")}, ${sqlite});\nconsole.log(db.${place});\n`,
    prints: place => `${place}\n`,
  },
  "a name that the build cannot see, beside a written one": {
    main: () =>
      `const written = await import("./data.sqlite", ${sqlite});\nconst chosen = await import(JSON.parse('"./data.sqlite"'), ${sqlite});\nconsole.log(chosen.default.${place}, chosen.default === written.default);\n`,
    prints: place => `${place} true\n`,
  },
  "a written whole path beside a choice": {
    main: sources =>
      `const whole = await import(${JSON.stringify(join(sources, "data.sqlite"))}, ${sqlite});\nconst chosen = await import(${choose("./data.sqlite")}, ${sqlite});\nconsole.log(whole.default.${place}, chosen.default.${place});\n`,
    prints: place => `source ${place}\n`,
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { main, prints } = cases[name];
  using sources = tempDir("aot-a-database-under-a-chosen-name", {});
  using elsewhere = tempDir("aot-a-database-under-a-chosen-name-elsewhere", {});
  using empty = tempDir("aot-a-database-under-a-chosen-name-empty", {});
  using output = tempDir("aot-a-database-under-a-chosen-name-output", {});
  await Bun.write(join(String(sources), "main.mjs"), main(String(sources)));
  createDatabase(String(sources), "source");
  createDatabase(String(elsewhere), "elsewhere");
  const executable = join(String(output), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.mjs"], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints("source"), exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const where = { source: String(sources), elsewhere: String(elsewhere) };
  for (const [place, folder] of Object.entries(where)) {
    const compiled = await run([executable], folder, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints(place), exitCode: 0 });
  }
  const without = await run([executable], String(empty), bunEnv);
  expect({ stdout: without.stdout, exitCode: without.exitCode }).toEqual({ stdout: "", exitCode: 1 });
  expect(without.stderr).toContain("Cannot find module './");
});
