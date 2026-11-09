import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import "./hardened";
import { without } from "./harness/capabilities";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const timeout = 240_000;

const attempt = ([label, load]: string[]) =>
  `try { console.log(${JSON.stringify(label)}, ${load}); } catch (error) { console.log(${JSON.stringify(label)}, "threw", error.name, error.code); }\n`;

async function prepare() {
  const dir = tempDir("aot-query-and-code-from-disk", {
    "project/lib/data.json": `{ "mark": 7 }`,
    "project/lib/code.cjs": `exports.mark = "code";`,
    "project/lib/words.txt": `words`,
    "project/lib/module.cjs": `exports.mark = "module";`,
    "project/lib/held.cjs": `exports.mark = "held";`,
    "project/node_modules/left-out/package.json": `{ "name": "left-out", "main": "index.cjs" }`,
    "project/node_modules/left-out/index.cjs": `exports.mark = "left out";`,
    "project/node_modules/installed/package.json": `{ "name": "installed", "main": "index.cjs" }`,
    "project/node_modules/installed/index.cjs": `exports.mark = "installed";`,
    "elsewhere/empty.txt": "",
  });
  const project = join(String(dir), "project");
  const at = (name: string) => JSON.stringify(join(project, "lib", name));
  const requires = [
    ["a relative data file", `require("./lib/data.json?x").mark`],
    ["a relative file of code", `require("./lib/code.cjs?x").mark`],
    ["an absolute data file", `require(${at("data.json?y")}).mark`],
    ["an absolute file of code", `require(${at("code.cjs?y")}).mark`],
    ["a package left outside", `require("left-out?x").mark`],
    ["a package", `require("installed?x").mark`],
    ["a file that the executable holds", `require("./lib/held.cjs").mark`],
    ["that file once more", `require("./lib/held.cjs?x").mark`],
  ];
  const imports = [
    ["a relative text as ?raw", `(await import("./lib/words.txt?raw")).default`],
    ["an import of code", `(await import("./lib/module.cjs?x")).default.mark`],
  ];
  await Bun.write(join(project, "requires.cjs"), requires.map(attempt).join(""));
  await Bun.write(join(project, "main.mjs"), `import "./requires.cjs";\n${imports.map(attempt).join("")}`);
  const executable = join(String(dir), isWindows ? "program.exe" : "program");
  const build = (...flags: string[]) =>
    spawned(
      [bunExe(), "build", "--compile", ...flags, "--external", "left-out", "./main.mjs", "--outfile", executable],
      project,
      bunEnv,
    );
  const printedIn = async (folder: string, ...command: string[]) => (await spawned(command, folder, bunEnv)).stdout;
  return { dir, project, elsewhere: join(String(dir), "elsewhere"), executable, build, printedIn };
}

const everyLoad = `a relative data file 7
a relative file of code code
an absolute data file 7
an absolute file of code code
a package left outside left out
a package installed
a file that the executable holds held
that file once more held
a relative text as ?raw words
an import of code module
`;

describe("a name under a query of which the build makes no second module", () => {
  test.concurrent(
    "stops the build of an executable",
    async () => {
      const { dir, build } = await prepare();
      using _ = dir;
      const stopped = await build("--aot");
      expect(stopped.exitCode).toBe(1);
      expect(stopped.stderr.match(/error: TS100159: /g)).toHaveLength(8);
      expect(stopped.stderr).not.toContain("module.cjs?x");
    },
    timeout,
  );

  test.concurrent(
    "an executable without --aot",
    async () => {
      const { dir, project, elsewhere, executable, build, printedIn } = await prepare();
      using _ = dir;
      expect(await printedIn(project, bunExe(), "./main.mjs")).toBe(everyLoad);
      built(await build());
      expect(await printedIn(project, executable)).toBe(`a relative data file threw Error undefined
a relative file of code threw Error undefined
an absolute data file threw Error undefined
an absolute file of code threw Error undefined
a package left outside threw Error undefined
a package threw Error undefined
a file that the executable holds held
that file once more threw Error undefined
a relative text as ?raw words
an import of code module
`);
      expect(await printedIn(elsewhere, executable)).toBe(`a relative data file threw Error undefined
a relative file of code threw Error undefined
an absolute data file threw Error undefined
an absolute file of code threw Error undefined
a package left outside threw Error undefined
a package threw Error undefined
a file that the executable holds held
that file once more threw Error undefined
a relative text as ?raw threw ResolveMessage ERR_MODULE_NOT_FOUND
an import of code threw ResolveMessage ERR_MODULE_NOT_FOUND
`);
    },
    timeout,
  );

  test.concurrent.skipIf(!without("a hardened build"))(
    "an executable with --aot-allow-code-from-disk",
    async () => {
      const { dir, project, elsewhere, executable, build, printedIn } = await prepare();
      using _ = dir;
      built(await build("--aot", "--aot-allow-code-from-disk"));
      expect(await printedIn(project, executable)).toBe(`a relative data file 7
a relative file of code code
an absolute data file 7
an absolute file of code code
a package left outside left out
a package installed
a file that the executable holds held
that file once more threw BuildMessage undefined
a relative text as ?raw words
an import of code module
`);
      expect(await printedIn(elsewhere, executable)).toBe(`a relative data file threw ResolveMessage MODULE_NOT_FOUND
a relative file of code threw ResolveMessage MODULE_NOT_FOUND
an absolute data file 7
an absolute file of code code
a package left outside threw ResolveMessage MODULE_NOT_FOUND
a package threw ResolveMessage MODULE_NOT_FOUND
a file that the executable holds held
that file once more threw BuildMessage undefined
a relative text as ?raw threw ResolveMessage ERR_MODULE_NOT_FOUND
an import of code module
`);
    },
    timeout,
  );

  test.concurrent.skipIf(!without("a hardened build"))(
    "bun run --aot with --aot-allow-code-from-disk",
    async () => {
      const { dir, project, printedIn } = await prepare();
      using _ = dir;
      const printed = await printedIn(project, bunExe(), "run", "--aot", "--aot-allow-code-from-disk", "./main.mjs");
      expect(printed).toBe(everyLoad);
    },
    timeout,
  );
});

describe("a file: URL with a query or a fragment, of a file that the executable holds", () => {
  async function printed(...flags: string[]) {
    using dir = tempDir("aot-file-url-under-a-query", {
      "counted.mjs": `globalThis.count = (globalThis.count ?? 0) + 1;\nexport const id = globalThis.count;\n`,
      "main.mjs": `if (globalThis.never) await import("./counted.mjs");
const href = new URL("./counted.mjs", import.meta.url).href;
for (const suffix of ["?a", "#a", "?a#a", ""]) {
  try {
    console.log(JSON.stringify(suffix), (await import(href + suffix)).id);
  } catch (error) {
    console.log(JSON.stringify(suffix), "threw", error.name, error.code);
  }
}
`,
    });
    const executable = join(String(dir), isWindows ? "program.exe" : "program");
    built(
      await spawned(
        [bunExe(), "build", "--compile", ...flags, "./main.mjs", "--outfile", executable],
        String(dir),
        bunEnv,
      ),
    );
    return (await spawned([executable], String(dir), bunEnv)).stdout;
  }
  const oneModule = `"?a" 1\n"#a" 1\n"?a#a" 1\n"" 1\n`;

  test.concurrent(
    "is answered by the one module of that file",
    async () => {
      expect(await printed("--aot")).toBe(oneModule);
    },
    timeout,
  );

  test.concurrent.skipIf(!without("a hardened build"))(
    "is answered by the one module of that file where code may come from disk",
    async () => {
      expect(await printed("--aot", "--aot-allow-code-from-disk")).toBe(oneModule);
    },
    timeout,
  );
});
