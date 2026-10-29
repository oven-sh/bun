import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

type Files = Record<string, string>;
type Command = (program: string, mode: string) => string[];

const MODES = ["bundle", "aot"];
const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const exe = (name: string) => name + (isWindows ? ".exe" : "");

const BUILD = `import plugins from "./plugins";
const result = await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: process.argv[2], aot: process.argv[3] === "aot" }, plugins, throw: false });
for (const log of result.logs) console.log(String(log));
process.exit(result.success ? 0 : 1);
`;

const commandLine =
  (...flags: string[]): Command =>
  (program, mode) => [
    bunExe(),
    "build",
    "--compile",
    ...(mode === "aot" ? ["--aot"] : []),
    ...flags,
    "main.ts",
    "--outfile",
    program,
  ];
const buildScript: Command = (program, mode) => [bunExe(), "build.ts", program, mode];

const page = (title: string, script: string) => `<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <link rel="stylesheet" href="./shared.css" />
    <script type="module" src="./${script}"></script>
  </head>
  <body><img src="./logo.svg" /></body>
</html>
`;

const sharedFiles: Files = {
  "shared.css": ".shared-by-both-pages {\n  color: red;\n}\n",
  "logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      types: [],
      lib: ["esnext", "dom"],
    },
    files: ["main.ts"],
  }),
};

const importPage = (name: string) => `// @ts-ignore\nimport ${name} from "./${name}.html";\n`;

const PAGE_HELPERS = `declare const Bun: any;
type Page = { index: string; files: { input?: string; path: string; loader: string }[] };
async function hasFileWithText(page: Page, loader: string, text: string): Promise<boolean> {
  for (const file of page.files) {
    if (file.loader === loader && (await Bun.file(file.path).text()).includes(text)) return true;
  }
  return false;
}
`;

const twoPagesProgram: Files = {
  "a.html": page("A", "a.ts"),
  "b.html": page("B", "b.ts"),
  "a.ts": 'document.title = "script of a";\n',
  "b.ts": 'document.title = "script of b";\n',
  "again.ts": importPage("a") + "export const again = a;\n",
  "main.ts":
    importPage("a") +
    importPage("b") +
    'import { again } from "./again";\n' +
    PAGE_HELPERS +
    `const pathOf = (page: Page, input: string) => page.files.find(file => file.input === input)!.path;
async function printFiles(page: Page, script: string) {
  const loaders = page.files.map(file => file.loader).sort().join(" ");
  const hasStyles = await hasFileWithText(page, "css", "shared-by-both-pages");
  console.log(loaders, hasStyles, await hasFileWithText(page, "js", script));
}
await printFiles(a, "script of a");
await printFiles(b, "script of b");
console.log(pathOf(a, "logo.svg") === pathOf(b, "logo.svg"), a === again);
const names = Bun.embeddedFiles.map((file: any) => file.name);
console.log(names.length > 0 && new Set(names).size === names.length);
`,
};
const TWO_PAGES_OUTPUT = "css file html js true true\ncss file html js true true\ntrue true\ntrue\n";

async function expectInBothModes(command: Command, files: Files, output: string) {
  using dir = tempDir("aot-pages", { ...sharedFiles, ...files });
  const folder = String(dir);
  for (const mode of MODES) {
    const program = join(folder, exe(mode));
    const built = await spawned(command(program, mode), folder, bunEnv);
    expect({ mode, ...built }).toEqual({
      mode,
      stdout: expect.any(String),
      stderr: expect.any(String),
      exitCode: 0,
      signal: null,
    });
    const ran = await spawned([program], folder, mode === "aot" ? COMPILED : bunEnv);
    expect({ mode, ...ran }).toEqual({ mode, stdout: output, stderr: expect.any(String), exitCode: 0, signal: null });
  }
}

const twoPagesBuilds: [name: string, flags: string[]][] = [
  ["two pages share a stylesheet and an image, one page imported twice", []],
  ["two pages with source maps", ["--sourcemap=external"]],
];

const failures: [name: string, script: string, files: Files, message: RegExp][] = [
  ["page with a missing script", "missing.ts", {}, /missing\.ts/],
  ["page with a syntax error in its script", "broken.ts", { "broken.ts": "const = 1;\n" }, /broken\.ts:1:\d/],
];

describe.concurrent("compile/aot/load/pages", () => {
  test.each(twoPagesBuilds)(
    "%s",
    (_, flags) => slot(() => expectInBothModes(commandLine(...flags), twoPagesProgram, TWO_PAGES_OUTPUT)),
    600_000,
  );

  test(
    "served page",
    () =>
      slot(() =>
        expectInBothModes(
          commandLine(),
          {
            "a.html": page("A", "a.ts"),
            "a.ts": 'document.title = "script of a";\n',
            "main.ts":
              importPage("a") +
              `declare const Bun: any;
const server = Bun.serve({ port: 0, routes: { "/": a } });
console.log((await (await fetch(server.url)).text()).includes("<title>A</title>"));
server.stop(true);
`,
          },
          "true\n",
        ),
      ),
    600_000,
  );

  test(
    "page with a plugin",
    () =>
      slot(() =>
        expectInBothModes(
          buildScript,
          {
            "build.ts": BUILD,
            "plugins.ts": `export default [{ name: "p", setup(b: any) {
b.onLoad({ filter: ${/\.tmpl$/} }, () => ({ contents: 'export default "from the plugin";', loader: "js" }));
} }];
`,
            "c.html": page("C", "c.ts"),
            "c.ts": '// @ts-ignore\nimport text from "./widget.tmpl";\ndocument.title = text;\n',
            "widget.tmpl": "",
            "main.ts":
              importPage("c") + PAGE_HELPERS + 'console.log(await hasFileWithText(c, "js", "from the plugin"));\n',
          },
          "true\n",
        ),
      ),
    600_000,
  );

  test.each(failures)(
    "%s",
    (_, script, files, message) =>
      slot(async () => {
        using dir = tempDir("aot-pages", {
          ...sharedFiles,
          ...files,
          "d.html": page("D", script),
          "main.ts": importPage("d") + "console.log(typeof d);\n",
        });
        const folder = String(dir);
        for (const mode of MODES) {
          const program = join(folder, exe(mode));
          const built = await spawned(commandLine()(program, mode), folder, bunEnv);
          expect({
            mode,
            output: built.stdout + built.stderr,
            exitCode: built.exitCode,
            signal: built.signal,
            wrote: existsSync(program),
          }).toEqual({ mode, output: expect.stringMatching(message), exitCode: 1, signal: null, wrote: false });
        }
      }),
    600_000,
  );
});
