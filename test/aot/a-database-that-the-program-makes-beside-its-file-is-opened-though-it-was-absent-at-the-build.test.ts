// The program makes a database beside its file and then imports it by a path made of the file's own folder. The file is not there at the build. The executable opens it
// when the import runs, as `bun <file>` and an executable of `bun build --compile` do. A database that never comes to be is refused in all three.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const make = `const { Database } = require("bun:sqlite");\nconst path = require("node:path");\nconst made = new Database(path.join(__dirname, "new.sqlite"), { create: true });\nmade.run("create table t (x)");\nmade.run("insert into t values (7)");\nmade.close();\n`;
const open = (name: string) =>
  `import(${name}, { with: { type: "sqlite" } }).then(\n  ({ default: db }) => console.log("opened", db.query("select count(*) as n from t").get().n),\n  error => console.log("threw", error.name),\n);\n`;

const cases: Record<string, { text: string; prints: string }> = {
  "a sum": { text: make + open(`__dirname + "/new.sqlite"`), prints: "opened 1\n" },
  "path.join": { text: make + open(`path.join(__dirname, "new.sqlite")`), prints: "opened 1\n" },
  "a relative name": { text: make + open(`"./new.sqlite"`), prints: "opened 1\n" },
  "a database that never comes to be": { text: open(`__dirname + "/never.sqlite"`), prints: "threw ResolveMessage\n" },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { text, prints } = cases[name];
  using sources = tempDir("aot-a-database-that-the-program-makes", { "main.cjs": text });
  using output = tempDir("aot-a-database-that-the-program-makes-output", {});
  const executable = join(String(output), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], String(sources), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
});
