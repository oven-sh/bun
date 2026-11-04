// TS100064 says that a load's path isn't a constant and may name code that isn't in the executable. Where the build has read
// every name that the path can be and has found a module under each, there is nothing to warn of. Where one name is missing,
// or the build can't read the name, the warning stays.
//
// The loads that are quiet are the modules of one program and those that are warned of of another: two entry points of one build,
// each compiled as it is when it is built alone. A warning names its file.
import { expect } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { separatePrograms, startsAtAnyEntryPoint } from "./harness/separate-programs";
import { test } from "./supported";

const never = "process.argv.length > 99";
const files = {
  "app/lib/a.js": `module.exports = "a";\n`,
  "app/lib/b.mjs": `export default "b";\n`,
  "app/lib/c.js": `module.exports = "c";\n`,
};
const quiet: [string, string, string, string][] = [
  [
    "the href of a URL",
    "href.mjs",
    `console.log((await import(new URL("./lib/b.mjs", import.meta.url).href)).default);\n`,
    "b\n",
  ],
  ["a URL", "url.mjs", `console.log((await import(new URL("./lib/b.mjs", import.meta.url))).default);\n`, "b\n"],
  [
    "what import.meta.resolve answers",
    "resolve.mjs",
    `console.log((await import(import.meta.resolve("./lib/b.mjs"))).default);\n`,
    "b\n",
  ],
  [
    "a template over a list of one",
    "one.cjs",
    `const n = ["a"][0];\nconsole.log(require(\`./lib/\${n}.js\`));\n`,
    "a\n",
  ],
  [
    "a template over two names",
    "two.cjs",
    `const n = ${never} ? "c" : "a";\nconsole.log(require(\`./lib/\${n}.js\`));\n`,
    "a\n",
  ],
];
const warned: [string, string, string][] = [
  [
    "one of two names has no file",
    "missing.cjs",
    `const n = ${never} ? "x" : "a";\nconsole.log(require(\`./lib/\${n}.js\`));\n`,
  ],
  [
    "a name out of the environment",
    "environment.cjs",
    `console.log(require(process.env.NAME_OF_MODULE ?? "./lib/a.js"));\n`,
  ],
];

const loadsEach = (rows: string[][]) => rows.map(([, file]) => `await import("./${file}");\n`).join("");
const programs = separatePrograms(
  "known-name-warnings",
  {
    ...files,
    ...Object.fromEntries([...quiet, ...warned].map(([, file, text]) => [`app/${file}`, text])),
    "app/quiet.mjs": loadsEach(quiet),
    "app/warned.mjs": loadsEach(warned),
  },
  ["app/quiet.mjs", "app/warned.mjs"],
);

let asked: Promise<string[]> | undefined;
/** The files that the build warned of. When it answers, the sources are gone. */
const warnedOf = () =>
  (asked ??= programs.build().then(({ stdout, stderr }) => {
    rmSync(join(programs.folder, "app"), { recursive: true });
    const said = stdout + stderr;
    const places = Array.from(said.matchAll(/\bTS100064\b.*\n\s*at .*[\\/]([^\\/:]+):\d+:\d+$/gm), place => place[1]);
    expect(places).toHaveLength(said.split("TS100064").length - 1);
    return places;
  }));
let ran: Promise<string[]> | undefined;
/** What each quiet load printed, in the order of the table. */
const printed = () =>
  (ran ??= warnedOf()
    .then(() => programs.start("app/quiet.mjs"))
    .then(({ stdout }) => stdout.split(/(?<=\n)/)));

test.each(quiet)("no warning: %s", async (_, file, __, expected) => {
  expect(await warnedOf()).not.toContain(file);
  if (startsAtAnyEntryPoint) expect((await printed())[quiet.findIndex(row => row[1] === file)]).toBe(expected);
});

test.each(warned)("still warned: %s", async (_, file) => {
  expect(await warnedOf()).toContain(file);
});
