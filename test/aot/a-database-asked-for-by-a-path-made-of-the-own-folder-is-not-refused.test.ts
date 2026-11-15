// `import(__dirname + "/" + name + ".sqlite", { with: { type: "sqlite" } })`: a whole path. `__dirname` holds the folder of the build, as with `bun build --compile`,
// so the database of that folder is opened wherever the program runs. Each executable is started in its source folder, in a folder that holds a database of its
// own, and in one that holds none.
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const rest = `{ with: { type: "sqlite" } }).then(({ default: db }) => console.log(db.query("select place from places").get().place));\n`;

function createDatabase(folder: string, place: string) {
  const database = new Database(join(folder, "data.sqlite"));
  database.exec("create table places (place text)");
  database.query("insert into places values (?)").run(place);
  database.close();
}

const cases: Record<string, string> = {
  "a name with a hole": `import(__dirname + "/" + JSON.parse('"data"') + ".sqlite", ${rest}`,
  "a choice of paths": `import(process.argv.length > 99 ? __dirname + "/other.sqlite" : __dirname + "/data.sqlite", ${rest}`,
  "path.join": `const path = require("node:path");\nimport(path.join(__dirname, JSON.parse('"data"') + ".sqlite"), ${rest}`,
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  using sources = tempDir("aot-a-database-by-a-path-made-of-the-own-folder", { "main.cjs": cases[name] });
  using elsewhere = tempDir("aot-a-database-by-a-path-made-of-the-own-folder-elsewhere", {});
  using empty = tempDir("aot-a-database-by-a-path-made-of-the-own-folder-empty", {});
  using output = tempDir("aot-a-database-by-a-path-made-of-the-own-folder-output", {});
  createDatabase(String(sources), "source");
  createDatabase(String(elsewhere), "elsewhere");
  const executable = join(String(output), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  for (const folder of [sources, elsewhere, empty]) {
    const plain = await run([bunExe(), join(String(sources), "main.cjs")], String(folder), bunEnv);
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "source\n", exitCode: 0 });
    const compiled = await run([executable], String(folder), bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: "source\n", exitCode: 0 });
  }
});
