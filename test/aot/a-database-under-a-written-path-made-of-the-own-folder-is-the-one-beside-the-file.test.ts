// `import(__dirname + "/data.sqlite", { with: { type: "sqlite" } })`: a whole path, written out. `__dirname` holds the folder of the build, as with
// `bun build --compile`, so the database beside the file is opened wherever the program runs. A relative name is opened where the program runs. Each executable is
// started in its source folder and in a folder that holds a database of its own.
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

type Case = { text: string; isBesideFile: boolean };
const cases: Record<string, Case> = {
  "a sum": { text: `import(__dirname + "/data.sqlite", ${rest}`, isBesideFile: true },
  "a template": { text: "import(`${__dirname}/data.sqlite`, " + rest, isBesideFile: true },
  "path.join": {
    text: `const path = require("node:path");\nimport(path.join(__dirname, "data.sqlite"), ${rest}`,
    isBesideFile: true,
  },
  "the folder kept in a constant": {
    text: `const folder = __dirname;\nimport(folder + "/data.sqlite", ${rest}`,
    isBesideFile: true,
  },
  "a relative name": { text: `import("./data.sqlite", ${rest}`, isBesideFile: false },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { text, isBesideFile } = cases[name];
  using sources = tempDir("aot-a-database-under-a-written-path-made-of-the-own-folder", { "main.cjs": text });
  using elsewhere = tempDir("aot-a-database-under-a-written-path-made-of-the-own-folder-elsewhere", {});
  using output = tempDir("aot-a-database-under-a-written-path-made-of-the-own-folder-output", {});
  createDatabase(String(sources), "source");
  createDatabase(String(elsewhere), "elsewhere");
  const executable = join(String(output), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const plainExecutable = join(String(output), isWindows ? "plain.exe" : "plain");
  const builtPlain = await run(
    [bunExe(), "build", "--compile", "main.cjs", "--outfile", plainExecutable],
    String(sources),
  );
  expect(builtPlain.exitCode).toBe(0);
  const places = { source: String(sources), elsewhere: String(elsewhere) };
  for (const [place, folder] of Object.entries(places)) {
    const prints = { stdout: `${isBesideFile ? "source" : place}\n`, exitCode: 0 };
    const plain = await run([plainExecutable], folder, bunEnv);
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual(prints);
    const compiled = await run([executable], folder, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual(prints);
  }
});
