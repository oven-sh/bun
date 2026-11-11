// `bun build --compile --aot main.mjs table.json`: a further entry point that is data, beside a database that a statement imports. The build gives every entry
// point that is code a first request of its own making; data takes none. Each case prints what the plain executable prints.
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const main = `import db from "./data.sqlite" with { type: "sqlite" };\nconsole.log(db.query("select place from places").get().place);\n`;
const cases: Record<string, Uint8Array | string> = {
  "table.json": `{ "n": 1 }\n`,
  "table.txt": "a text\n",
  "table.unknown": Buffer.from(Array.from({ length: 300 }, (_, index) => 0x80 | ((index * 37) % 0x80))),
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  using sources = tempDir("aot-an-entry-point-that-is-data", { "main.mjs": main });
  using output = tempDir("aot-an-entry-point-that-is-data-output", {});
  writeFileSync(join(String(sources), name), cases[name]);
  const database = new Database(join(String(sources), "data.sqlite"));
  database.exec("create table places (place text)");
  database.query("insert into places values (?)").run("start");
  database.close();
  for (const [flags, file] of [
    [[], "plain"],
    [["--aot"], "program"],
  ] as const) {
    const executable = join(String(output), isWindows ? `${file}.exe` : file);
    const built = await run(
      [bunExe(), "build", "--compile", ...flags, "main.mjs", name, "--outfile", executable],
      String(sources),
    );
    expect({ file, exitCode: built.exitCode }).toEqual({ file, exitCode: 0 });
    const ran = await run([executable], String(sources), bunEnv);
    expect({ file, stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ file, stdout: "start\n", exitCode: 0 });
  }
});
