// `bun build --compile` on the command line, without `--aot` and with it: the plugins that a bunfig.toml names, preloads that call
// Bun.plugin, and the flags that change what a program is made of. Both builds succeed, the plugins are told the same, and both
// executables print the same. A plugin tells by appending a line to the file that TOLD names.
import { expect } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

type Case = {
  files: Record<string, string>;
  flags?: string[];
  prints?: string;
  interprets?: true;
  env?: Record<string, string>;
  // For the executables alone.
  runEnv?: Record<string, string>;
  // The executable built with --aot runs only code that was compiled into it: it exits with code 1, and its message holds this text.
  refusedAtStart?: string;
};

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "preserve",
    moduleResolution: "bundler",
    resolveJsonModule: true,
    allowJs: true,
    types: [],
  },
  exclude: ["plugin.ts", "register.ts"],
});

const tell = `import { appendFileSync } from "fs";
function tell(hook: string, args: Record<string, unknown>) {
  const shown = Object.entries(args).map(([name, value]) => name + "=" + (typeof value === "function" ? "function" : JSON.stringify(value)));
  appendFileSync(process.env.TOLD!, (hook + " " + shown.join(" ")).replaceAll(import.meta.dir, "<folder>") + "\\n");
}
`;

const page = {
  "main.ts": `import page from "./page.html";
const server = Bun.serve({ port: 0, routes: { "/": page } });
const html: string = await (await fetch(server.url)).text();
const script = await (await fetch(new URL(/<script[^>]* src="([^"]+)"/.exec(html)![1], server.url))).text();
console.log(script.includes("client from the plugin"), script.includes("client on the disk"));
server.stop(true);`,
  "types.d.ts": `declare module "*.html" { const page: any; export default page; } declare const Bun: any;`,
  "page.html": `<!doctype html><html><head><script type="module" src="./client.ts"></script></head><body></body></html>`,
  "client.ts": `console.log("client on the disk");`,
};

const cases: Record<string, Case> = {
  "[serve.static] plugins of bunfig.toml are for a server that bundles when it runs: a build does not ask them": {
    files: {
      ...page,
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "plugin.ts": `${tell}export default { name: "static", setup(build: any) {
  build.onLoad({ filter: /client\\.ts$/ }, (args: any) => { tell("onLoad", args); return { contents: 'console.log("client from the plugin");', loader: "ts" }; });
} };`,
    },
    prints: "false true\n",
  },
  "[serve.static] plugins of bunfig.toml and the files of the server": {
    files: {
      ...page,
      "main.ts": `import { word } from "./word";\nconsole.log(word);\n` + page["main.ts"],
      "word.ts": `export const word: string = "word on the disk";`,
      "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
      "plugin.ts": `${tell}export default { name: "static", setup(build: any) {
  build.onLoad({ filter: /\\.ts$/ }, (args: any) => void tell("onLoad", args));
  build.onLoad({ filter: /word\\.ts$/ }, () => ({ contents: 'export const word: string = "word from the plugin";', loader: "ts" }));
} };`,
    },
  },
  // Neither build reads it. The executable without --aot runs it when it starts, where its plugin is too late for what is compiled.
  // The one with --aot ignores it.
  "a preload of bunfig.toml that calls Bun.plugin": {
    files: {
      "main.ts": `import { word } from "./word"; console.log(word);`,
      "word.ts": `export const word: string = "word on the disk";`,
      "bunfig.toml": `preload = ["./register.ts"]\n`,
      "register.ts": `${tell}Bun.plugin({ name: "registered", setup(build) {
  build.onLoad({ filter: /word\\.ts$/ }, args => { tell("onLoad", args as any); return { contents: 'export const word: string = "word from the plugin";', loader: "ts" }; });
} });`,
    },
    prints: "word on the disk\n",
  },
  "--define, --drop and --feature": {
    files: {
      "main.ts": `import { feature } from "bun:bundle"; declare const WORD: string; console.log(WORD, feature("ON") ? "on" : "off", feature("OFF") ? "on" : "off"); console.debug("dropped");`,
      "types.d.ts": `declare module "bun:bundle" { export function feature(name: string): boolean; }`,
    },
    flags: ["--define", `WORD="word"`, "--drop=console.debug", "--feature=ON"],
    prints: "word on off\n",
  },
  "--loader and --conditions": {
    files: {
      "main.ts": `import text from "./note.custom"; import { which } from "pkg"; console.log(text.trim(), which);`,
      "types.d.ts": `declare module "*.custom" { const text: string; export default text; } declare module "pkg" { export const which: string; }`,
      "note.custom": "custom text\n",
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "exports": { ".": { "custom": "./custom.js", "default": "./default.js" } } }`,
      "node_modules/pkg/custom.js": `export const which = "custom";`,
      "node_modules/pkg/default.js": `export const which = "default";`,
    },
    flags: ["--loader", ".custom:text", "--conditions", "custom"],
    prints: "custom text custom\n",
  },
  "--external and --packages external": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { a } from "pkg"; import { b } from "./outside.mjs"; console.log(a, b);`,
      "outside.mjs": `export const b = "file at run time";`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "./index.js" }`,
      "node_modules/pkg/index.js": `exports.a = "package at run time";`,
    },
    flags: ["--external", "./outside.mjs", "--packages", "external"],
    interprets: true,
    prints: "package at run time file at run time\n",
  },
  "--env": {
    files: { "main.ts": `declare const process: any; console.log(process.env.PUBLIC_WORD, process.env.PRIVATE_WORD);` },
    flags: ["--env=PUBLIC_*"],
    env: { PUBLIC_WORD: "at the build", PRIVATE_WORD: "at the build" },
    runEnv: { PUBLIC_WORD: "at run time", PRIVATE_WORD: "at run time" },
    prints: "at the build at run time\n",
  },
  "--tsconfig-override": {
    files: {
      "main.ts": `import { a } from "@lib/a"; console.log(a);`,
      "other.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "preserve",
          moduleResolution: "bundler",
          types: [],
          paths: { "@lib/*": ["./other/*"] },
        },
      }),
      "other/a.ts": `export const a = "other";`,
    },
    flags: ["--tsconfig-override", "./other.json"],
    prints: "other\n",
  },
  "a plugin that an executable registers when it starts": {
    files: {
      "main.ts": `const late = await import((globalThis as any).process.cwd() + "/late.words"); console.log(late.default);`,
      "late.words": "on the disk",
      "register.ts": `Bun.plugin({ name: "registered", setup(build) {
  build.onLoad({ filter: /\\.words$/ }, () => ({ exports: { default: "from the plugin" }, loader: "object" }));
} });`,
    },
    runEnv: { BUN_OPTIONS: "--preload ./register.ts" },
    interprets: true,
    prints: "from the plugin\n",
    refusedAtStart: "can't be used with this executable because it only runs code that was compiled into it",
  },
};

describe.concurrent("compile/aot/plugins and flags of bun build on the command line", () => {
  for (const [name, it] of Object.entries(cases)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-build-cli", { "tsconfig.json": tsconfig, ...it.files });
          const folder = String(dir);
          const results = [];
          for (const how of ["plain", "aot"]) {
            const told = join(folder, "told.txt");
            rmSync(told, { force: true });
            const env = { ...bunEnv, ...it.env, TOLD: told };
            const executable = join(folder, how + (isWindows ? ".exe" : ""));
            const command = [
              bunExe(),
              "build",
              "--compile",
              ...(how === "aot" ? ["--aot"] : []),
              ...(it.flags ?? []),
              "./main.ts",
              "--outfile",
              executable,
            ];
            const build = await spawned(command, folder, env);
            expect({ how, stderr: build.stderr, exitCode: build.exitCode }).toEqual({
              how,
              stderr: expect.not.stringMatching(/^error\b/m),
              exitCode: 0,
            });
            const lines = existsSync(told) ? readFileSync(told, "utf8").split("\n").filter(Boolean).sort() : [];
            const ran = await spawned([executable], folder, {
              ...env,
              ...it.runEnv,
              ...(how === "aot" && !it.interprets ? { BUN_JSC_crashIfInterpreterIsUsed: "1" } : {}),
            });
            results.push({
              told: lines,
              stdout: ran.stdout,
              stderr: ran.exitCode === 0 ? "" : ran.stderr,
              exitCode: ran.exitCode,
              signal: ran.signal,
            });
          }
          const [plain, aot] = results;
          expect(plain).toMatchObject({
            exitCode: 0,
            signal: null,
            ...(it.prints === undefined ? {} : { stdout: it.prints }),
          });
          if (it.refusedAtStart === undefined) expect(aot).toEqual(plain);
          else
            expect(aot).toEqual({
              told: plain.told,
              stdout: "",
              stderr: expect.stringContaining(it.refusedAtStart),
              exitCode: 1,
              signal: null,
            });
        }),
      600_000,
    );
  }
});
