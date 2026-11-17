// `import db from "./data.sqlite" with { type: "sqlite" }`: a database that is not embedded is looked up in the working directory. For a statement, wherever it stands,
// that is the folder in which the program was started, as in an executable of `bun build --compile`, whose bundle keeps the statement at its top. For `import()` it is
// the working directory at the call. The folder of the sources holds a database and a folder `inner` with a database of its own. Each case prints what the plain
// executable prints; the last is held against `bun <the main file>`, since the plain executable throws where `module.children` is mentioned.
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const place = `query("select place from places").get().place`;
const statement = `import db from "./data.sqlite" with { type: "sqlite" };\n`;
const enter = `process.chdir("inner");\n`;
const rows = `${statement}export const place = () => db.${place};\n`;

function createDatabase(folder: string, place: string) {
  const database = new Database(join(folder, "data.sqlite"));
  database.exec("create table places (place text)");
  database.query("insert into places values (?)").run(place);
  database.close();
}

type Case = { main: string; files: Record<string, string>; prints: string; isHeldAgainstSource?: boolean };
const cases: Record<string, Case> = {
  "a module in front of the statement changes the folder": {
    main: "main.mjs",
    files: { "enter.mjs": enter, "main.mjs": `import "./enter.mjs";\n${statement}console.log(db.${place});\n` },
    prints: "start\n",
  },
  "the statement stands one file down": {
    main: "main.mjs",
    files: {
      "enter.mjs": enter,
      "rows.mjs": rows,
      "main.mjs": `import "./enter.mjs";\nimport { place } from "./rows.mjs";\nconsole.log(place());\n`,
    },
    prints: "start\n",
  },
  "a call brings the file with the statement behind the change": {
    main: "main.mjs",
    files: {
      "rows.mjs": rows,
      "main.mjs": `${enter}const { place } = await import("./rows.mjs");\nconsole.log(place());\n`,
    },
    prints: "start\n",
  },
  "the file that a call brings loads the module that changes the folder": {
    main: "main.mjs",
    files: {
      "enter.mjs": enter,
      "rows.mjs": `import "./enter.mjs";\n${rows}`,
      "main.mjs": `const { place } = await import("./rows.mjs");\nconsole.log(place());\n`,
    },
    prints: "start\n",
  },
  "a CommonJS module changes the folder": {
    main: "main.mjs",
    files: { "enter.cjs": enter, "main.mjs": `import "./enter.cjs";\n${statement}console.log(db.${place});\n` },
    prints: "start\n",
  },
  "the entry point is a CommonJS module": {
    main: "main.cjs",
    files: {
      "rows.mjs": rows,
      "main.cjs": `${enter}import("./rows.mjs").then(({ place }) => console.log(place()));\n`,
    },
    prints: "start\n",
  },
  "the change stands behind the statement": {
    main: "main.mjs",
    files: { "enter.mjs": enter, "main.mjs": `${statement}import "./enter.mjs";\nconsole.log(db.${place});\n` },
    prints: "start\n",
  },
  "a call with the written name behind the change": {
    main: "main.mjs",
    files: {
      "main.mjs": `${enter}const db = (await import("./data.sqlite", { with: { type: "sqlite" } })).default;\nconsole.log(db.${place});\n`,
    },
    prints: "inner\n",
  },
  "a call behind the change in an entry point that is a CommonJS module": {
    main: "main.cjs",
    files: {
      "main.cjs": `${enter}import("./data.sqlite", { with: { type: "sqlite" } }).then(({ default: db }) => console.log(db.${place}));\n`,
    },
    prints: "inner\n",
  },
  "a CommonJS entry point requires the file with the statement": {
    main: "main.cjs",
    files: { "rows.mjs": rows, "main.cjs": `${enter}console.log(require("./rows.mjs").place());\n` },
    prints: "start\n",
  },
  "nothing more stands among the children of a CommonJS entry point": {
    main: "main.cjs",
    files: {
      "rows.mjs": rows,
      "main.cjs": `${enter}console.log(require("./rows.mjs").place(), module.children.length);\n`,
    },
    prints: "start 0\n",
    isHeldAgainstSource: true,
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { main, files, prints, isHeldAgainstSource } = cases[name];
  using sources = tempDir("aot-a-database-imported-by-a-statement", files);
  using output = tempDir("aot-a-database-imported-by-a-statement-output", {});
  mkdirSync(join(String(sources), "inner"));
  createDatabase(String(sources), "start");
  createDatabase(join(String(sources), "inner"), "inner");
  for (const [flags, file] of [
    [[], "plain"],
    [["--aot"], "program"],
  ] as const) {
    const executable = join(String(output), isWindows ? `${file}.exe` : file);
    const runsSource = isHeldAgainstSource && file === "plain";
    if (!runsSource) {
      const built = await run(
        [bunExe(), "build", "--compile", ...flags, main, "--outfile", executable],
        String(sources),
      );
      expect(built.exitCode).toBe(0);
    }
    const ran = await run(runsSource ? [bunExe(), main] : [executable], String(sources), bunEnv);
    expect({ file, stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ file, stdout: prints, exitCode: 0 });
  }
});
