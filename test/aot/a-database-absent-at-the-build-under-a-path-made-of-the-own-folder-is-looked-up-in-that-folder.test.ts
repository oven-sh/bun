// The program makes a database beside its file and imports it by a path made of the file's own folder. The file is not there at the build. The path means the folder of
// the build, as in `bun <file>` and in an executable of `bun build --compile`: not the working directory, though that holds a database of the same name.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const head = `const { Database } = require("bun:sqlite");\nconst fs = require("node:fs");\nconst path = require("node:path");\nfunction lay(file, rows) {\n  fs.mkdirSync(path.dirname(file), { recursive: true });\n  const made = new Database(file, { create: true });\n  made.run("create table t (x)");\n  for (let row = 0; row < rows; row++) made.run("insert into t values (7)");\n  made.close();\n}\n`;
const open = `import(__dirname + "/new.sqlite", { with: { type: "sqlite" } }).then(\n  ({ default: db }) => console.log("opened", db.query("select count(*) as n from t").get().n),\n  error => console.log("threw", error.name),\n);\n`;
const tool = `module.exports = () => import(__dirname + "/new.sqlite", { with: { type: "sqlite" } }).then(({ default: db }) => db.query("select count(*) as n from t").get().n);\n`;

const cases: Record<string, { files: Record<string, string>; prints: string }> = {
  "the working directory holds another of the name": {
    files: {
      "main.cjs": `${head}lay(path.join(__dirname, "new.sqlite"), 1);\nlay(path.join(__dirname, "inner", "new.sqlite"), 2);\nprocess.chdir(path.join(__dirname, "inner"));\n${open}`,
    },
    prints: "opened 1\n",
  },
  "the working directory holds none": {
    files: {
      "main.cjs": `${head}lay(path.join(__dirname, "new.sqlite"), 1);\nfs.mkdirSync(path.join(__dirname, "inner"));\nprocess.chdir(path.join(__dirname, "inner"));\n${open}`,
    },
    prints: "opened 1\n",
  },
  "two files in two folders": {
    files: {
      "one/tool.cjs": tool,
      "two/tool.cjs": tool,
      "main.cjs": `${head}lay(path.join(__dirname, "one", "new.sqlite"), 1);\nlay(path.join(__dirname, "two", "new.sqlite"), 2);\nPromise.all([require("./one/tool.cjs")(), require("./two/tool.cjs")()]).then(rows => console.log("opened", rows.join()));\n`,
    },
    prints: "opened 1,2\n",
  },
  "a database that never comes to be": {
    files: {
      "main.cjs": `import(__dirname + "/never.sqlite", { with: { type: "sqlite" } }).then(\n  () => console.log("opened"),\n  error => console.log("threw", error.name, require("node:fs").existsSync(__dirname + "/never.sqlite")),\n);\n`,
    },
    prints: "threw ResolveMessage false\n",
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { files, prints } = cases[name];
  for (const flags of [[], ["--aot"]]) {
    using sources = tempDir("aot-a-database-absent-at-the-build", files);
    using output = tempDir("aot-a-database-absent-at-the-build-output", {});
    const executable = join(String(output), isWindows ? "program.exe" : "program");
    const built = await run(
      [bunExe(), "build", "--compile", ...flags, "main.cjs", "--outfile", executable],
      String(sources),
    );
    expect(built.exitCode).toBe(0);
    const ran = await run([executable], String(sources), bunEnv);
    expect({ flags, stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ flags, stdout: prints, exitCode: 0 });
  }
});
