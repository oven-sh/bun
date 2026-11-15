import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// A file with JSX whose runtime is not installed. What an entry point reaches by written requires and imports is the program: the build stops, as `bun build --compile` does.
// A file that only a computed path may find is one that nobody may ever load: the build warns, and the load throws, as under `bun run`.
// istanbul-reports, and so jest and c8: `require(path.join(__dirname, "lib", name))`, and below lib the sources of a page, CommonJS files with JSX, whose React nobody installs.
const page = {
  cjs: `console.log("page runs");\nmodule.exports = () => <div>hi</div>;\n`,
  es: `console.log("page runs");\nexport default () => <div>hi</div>;\n`,
};
const text = { cjs: `module.exports = "text";\n`, es: `export default "text";\n` };
const tried = (load: (name: string) => string) => `console.log("main runs", ${load(`(process.argv[2] ?? "text")`)});
try {
  ${load(`(process.argv[3] ?? "page")`)};
  console.log("loaded");
} catch {
  console.log("threw");
}
`;
const stops = "stops";
const runs = ["main runs text", "threw", ""];
// [the files, what stock's --compile does, what --aot does]
const table: Record<string, [Record<string, string>, typeof stops | string[], typeof stops | string[]]> = {
  "entry, CommonJS": [{ "main.js": page.cjs }, stops, stops],
  "entry, ES": [{ "main.js": page.es }, stops, stops],
  "written, CommonJS": [
    { "lib/page.js": page.cjs, "main.js": `console.log(typeof require("./lib/page.js"));\n` },
    stops,
    stops,
  ],
  "written, ES": [
    { "lib/page.js": page.es, "main.js": `import page from "./lib/page.js";\nconsole.log(typeof page);\n` },
    stops,
    stops,
  ],
  "written behind written, CommonJS": [
    {
      "lib/page.js": page.cjs,
      "lib/index.js": `module.exports = require("./page.js");\n`,
      "main.js": `console.log(typeof require("./lib/index.js"));\n`,
    },
    stops,
    stops,
  ],
  "computed by path.join, CommonJS": [
    {
      "lib/page.js": page.cjs,
      "lib/text.js": text.cjs,
      "main.js":
        `const path = require("path");\n` + tried(name => `require(path.join(__dirname, "lib", ${name} + ".js"))`),
    },
    runs,
    runs,
  ],
  "written behind computed, CommonJS": [
    {
      "lib/page/part.js": page.cjs,
      "lib/page/index.js": `module.exports = require("./part.js");\n`,
      "lib/text/index.js": text.cjs,
      "main.js": `const path = require("path");\n` + tried(name => `require(path.join(__dirname, "lib", ${name}))`),
    },
    runs,
    runs,
  ],
  "computed by a pattern, CommonJS": [
    {
      "lib/page.js": page.cjs,
      "lib/text.js": text.cjs,
      "main.js": tried(name => `require("./lib/" + ${name} + ".js")`),
    },
    runs,
    runs,
  ],
  "computed by a pattern, ES": [
    {
      "lib/page.js": page.es,
      "lib/text.js": text.es,
      "main.js": tried(name => `(await import("./lib/" + ${name} + ".js")).default`),
    },
    runs,
    runs,
  ],
};

describe.concurrent("compile/aot/a JSX runtime that is not installed", () => {
  for (const [label, [files, ofStock, ofOurs]] of Object.entries(table)) {
    test(
      label,
      async () => {
        using dir = tempDir("aot-jsx-runtime-missing", { "package.json": `{ "name": "p" }`, ...files });
        const cwd = String(dir);
        const made = async (name: string, flags: string[]) => {
          const executable = join(cwd, name + (isWindows ? ".exe" : ""));
          const build = await run(
            [bunExe(), "build", "--compile", ...flags, "main.js", "--outfile", executable],
            cwd,
            bunEnv,
          );
          if (build.exitCode !== 0) {
            expect(build.stderr).toContain(`Could not resolve: "react/jsx-dev-runtime"`);
            return stops;
          }
          return (await run([executable], cwd, bunEnv)).stdout.split("\n");
        };
        expect({ stock: await made("plain", []), ours: await made("compiled", ["--aot"]) }).toEqual({
          stock: ofStock,
          ours: ofOurs,
        });
        if (ofOurs !== stops)
          expect((await run([bunExe(), "main.js"], cwd, bunEnv)).stdout.split("\n")).toEqual(ofOurs);
      },
      240_000,
    );
  }
});
