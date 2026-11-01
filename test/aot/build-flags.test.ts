// The flags of `bun build` that change what the program does. Each program is built with `--compile` and with `--compile --aot` under the same
// flags, and both executables print what is written here. A flag that --aot does not support stops the build with an error.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";

const packages = {
  "node_modules/cond/package.json": `{ "name": "cond", "version": "1.0.0", "exports": { "custom": "./custom.js", "default": "./default.js" } }`,
  "node_modules/cond/custom.js": `export default "custom";`,
  "node_modules/cond/default.js": `export default "default";`,
  "node_modules/mine/package.json": `{ "name": "mine", "version": "1.0.0", "exports": { "./jsx-runtime": "./r.js", "./jsx-dev-runtime": "./r.js" } }`,
  "node_modules/mine/r.js": `export const jsx = (t, p) => "mine:" + t + JSON.stringify(p); export const jsxs = jsx; export const jsxDEV = jsx; export const Fragment = "f";`,
};

const pathsThatEndInBrackets = {
  flags: [
    '--define=config.flat="built"',
    '--define=config.level.deep="built"',
    "--define=config.list=[1]",
    "--define=config.renamed=config.other",
    '--define=process.env.OWN="built"',
    '--define=import.meta.env.OWN="built"',
    "--drop=tools.trace",
  ],
  files: {
    "main.ts": `declare const config: { flat: string; level: { deep: string }; other: string; list?: number[]; renamed?: string };
declare const tools: { trace: { (text: string): void; deep(text: string): void } };
const called: string[] = [];
const call = (text: string) => void called.push(text);
(globalThis as any).config = { flat: "run", level: { deep: "run" }, other: "other" };
(globalThis as any).tools = { trace: Object.assign(call, { deep: call }) };
console.log(config.flat, config["flat"], config[\`flat\`], (config)[("flat")]);
console.log(config.level.deep, config["level"].deep, config.level["deep"], config["level"]["deep"]);
console.log(process.env.OWN, process["env"].OWN, process.env["OWN"], import.meta.env.OWN, import.meta.env["OWN"]);
console.log(config.list, config["list"], config.renamed, config["renamed"]);
tools.trace("a");
tools["trace"]("b");
tools.trace.deep("c");
tools["trace"].deep("d");
tools.trace["deep"]("e");
console.log("called:", called.join());`,
  },
};

const honored: Record<string, { flags: string[]; files: Record<string, string>; prints: string }> = {
  "--define": {
    flags: [
      "--define=LEVEL=41",
      '--define=NAME="named"',
      '--define=FLAGS={"a":true}',
      '--define=process.env.NODE_ENV="staging"',
    ],
    files: {
      "main.ts": `declare const LEVEL: number; declare const NAME: string; declare const FLAGS: { a: boolean }; console.log(LEVEL + 1, NAME, FLAGS.a, typeof LEVEL, process.env.NODE_ENV);`,
    },
    prints: "42 named true number staging\n",
  },
  "--define and --drop of a path that the program ends in brackets": {
    ...pathsThatEndInBrackets,
    prints:
      "built run run run\nbuilt built run run\nbuilt built undefined built undefined\n[ 1 ] undefined other undefined\ncalled: b,d,e\n",
  },
  "--define and --drop of a path that the program ends in brackets, with --minify-syntax": {
    ...pathsThatEndInBrackets,
    flags: [...pathsThatEndInBrackets.flags, "--minify-syntax"],
    prints:
      "built built built built\nbuilt built built built\nbuilt built built built built\n[ 1 ] [ 1 ] other other\ncalled: \n",
  },
  "--feature": {
    flags: ["--feature=ON"],
    files: {
      "main.ts": `import { feature } from "bun:bundle"; console.log(feature("ON") ? "on" : "off", feature("OFF") ? "on" : "off");`,
    },
    prints: "on off\n",
  },
  "--format=cjs": {
    flags: ["--format=cjs"],
    files: {
      "main.ts": `import { a } from "./a"; const b = require("./b.cjs"); console.log(a, b.b, import.meta.main);`,
      "a.ts": `export const a = "a";`,
      "b.cjs": `exports.b = "b";`,
    },
    prints: "a b true\n",
  },
  "--format=iife": {
    flags: ["--format=iife"],
    files: { "main.ts": `import { a } from "./a"; console.log(a);`, "a.ts": `export const a = "a";` },
    prints: "a\n",
  },
  "--env": {
    flags: ["--env=PUBLIC_*"],
    files: { "main.ts": `console.log(process.env.PUBLIC_ONE);`, ".env": "PUBLIC_ONE=from-dotenv\n" },
    prints: "from-dotenv\n",
  },
  "--conditions": {
    flags: ["--conditions=custom"],
    files: { ...packages, "main.mjs": `import which from "cond"; console.log(which);` },
    prints: "custom\n",
  },
  "--loader": {
    flags: ["--loader=.weird:text"],
    files: {
      "a.weird": "hello from a .weird file\n",
      "main.ts": `// @ts-ignore\nimport text from "./a.weird"; console.log(text.trim());`,
    },
    prints: "hello from a .weird file\n",
  },
  "--tsconfig-override": {
    flags: ["--tsconfig-override=other.json"],
    files: {
      "tsconfig.json": `{ "compilerOptions": { "paths": { "@lib": ["./one.ts"] } } }`,
      "other.json": `{ "compilerOptions": { "paths": { "@lib": ["./two.ts"] } } }`,
      "one.ts": `export default "one";`,
      "two.ts": `export default "two";`,
      "main.ts": `import which from "@lib"; console.log(which);`,
    },
    prints: "two\n",
  },
  "--jsx-runtime=classic, --jsx-factory, --jsx-fragment": {
    flags: ["--jsx-runtime=classic", "--jsx-factory=h", "--jsx-fragment=Frag"],
    files: {
      "main.jsx": `const h = (tag, props, ...kids) => tag + JSON.stringify(props) + kids.join(); const Frag = "frag"; console.log(<a b="c">d</a>, <>e</>);`,
    },
    prints: 'a{"b":"c"}d fragnulle\n',
  },
  "--jsx-import-source": {
    flags: ["--jsx-import-source=mine"],
    files: { ...packages, "main.jsx": `console.log(<a b="c">d</a>);` },
    prints: 'mine:a{"b":"c","children":"d"}\n',
  },
  "--compile-exec-argv": {
    flags: ["--compile-exec-argv=--smol"],
    files: { "main.ts": `console.log(JSON.stringify(process.execArgv));` },
    prints: '["--smol"]\n',
  },
  "--minify-syntax, --minify-whitespace": {
    flags: ["--minify-syntax", "--minify-whitespace"],
    files: {
      "main.ts": `const a = 1 + 2; function f(x: number) { if (x) { return true; } else { return false; } } console.log(a, f(1), f(0), void 0 === undefined);`,
    },
    prints: "3 true false true\n",
  },
  "--ignore-dce-annotations": {
    flags: ["--ignore-dce-annotations"],
    files: {
      "main.ts": `const effect = (n: string) => { ((globalThis as any).calls ??= []).push(n); return n; }; const unused = /* @__PURE__ */ effect("pure unused"); console.log((globalThis as any).calls.join());`,
    },
    prints: "pure unused\n",
  },
  "--production": {
    flags: ["--production"],
    files: { "main.ts": `console.log(process.env.NODE_ENV);` },
    prints: "production\n",
  },
  "--drop=console": {
    flags: ["--drop=console"],
    files: {
      "main.ts": `let evaluated = 0;
const held = console;
const say = (text: unknown) => void held.log(String(text));
console.log("dropped", evaluated++);
console.error.call(console, evaluated++);
console?.warn(evaluated++);
(console as any).info(evaluated++);
say(console.log("its value", evaluated++));
say(evaluated);
function shadows(console: { log(text: string): string }) { return console.log("a parameter by the name is called"); }
say(shadows({ log: text => text }));
{ const console = { log: (text: string) => "so is a constant: " + text }; say(console.log("called")); }
say(typeof console.log);
held.table = () => say("through another name it is called");
held.table();
say((console as any).log("as a test") ? "never" : "the arm for undefined");
import("./other").then(other => other.run());`,
      "other.ts": `export function run() { console.log("dropped in every file"); const held = console; held.log("other ran"); }`,
    },
    prints:
      "undefined\n0\na parameter by the name is called\nso is a constant: called\nfunction\nthrough another name it is called\nthe arm for undefined\nother ran\n",
  },
  "--drop of a global function, and of a path": {
    flags: ["--drop=assert", "--drop=tools.trace"],
    files: {
      "main.ts": `declare function assert(ok: boolean): void;
declare namespace assert { function equal(a: unknown, b: unknown): void; }
declare const tools: { trace: { (text: string): void; deep(text: string): void }; keep(text: string): string };
(globalThis as any).tools = { trace: () => { throw new Error("tools.trace was called"); }, keep: (text: string) => text };
let evaluated = 0;
assert(evaluated++ > 5);
assert.equal(evaluated++, 7);
tools.trace("dropped");
tools.trace.deep("dropped");
console.log(evaluated, tools.keep("kept"));`,
    },
    prints: "0 kept\n",
  },
  "--drop=debugger": {
    flags: ["--drop=debugger"],
    files: { "main.ts": `debugger; console.log("ran");` },
    prints: "ran\n",
  },
  "--banner and --footer that are comments": {
    flags: ["--banner=// a banner", "--footer=/* a footer */"],
    files: { "main.ts": `console.log("ran");` },
    prints: "ran\n",
  },
};

// These change every file of the build, or what another of them asks. The others are given to one build of one program.
const alone = /brackets|^--(format|jsx-runtime|minify|production|drop=console)/;
const together = Object.entries(honored).filter(([name]) => !alone.test(name));
for (const [name] of together) delete honored[name];
const mains = together.map(([, { files }], index) =>
  Object.keys(files)
    .find(file => file.startsWith("main."))!
    .replace(".", index + "."),
);
honored[together.map(([name]) => name).join(", ")] = {
  flags: together.flatMap(([, { flags }]) => flags),
  files: {
    ...Object.assign(
      {},
      ...together.map(([, { files }], index) =>
        Object.fromEntries(
          Object.entries(files).map(([file, text]) => [file.startsWith("main.") ? mains[index] : file, text]),
        ),
      ),
    ),
    "main.ts": mains.map(main => `import "./${main}";\n`).join(""),
  },
  prints: together.map(([, { prints }]) => prints).join(""),
};

const rejected: Record<string, string[]> = {
  "--banner with code": ["--banner=globalThis.fromBanner = 1;"],
  "--footer with code": ["--footer=globalThis.fromFooter = 1;"],
};

describe.concurrent("compile/aot/flags of bun build", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const [name, { flags, files, prints }] of Object.entries(honored)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-build-flags", files);
          const folder = String(dir);
          const main = "main.ts" in files ? "main.ts" : Object.keys(files).find(file => file.startsWith("main."))!;
          for (const how of [[], ["--aot"]]) {
            const executable = join(folder, "program" + how.length + (isWindows ? ".exe" : ""));
            const built = await spawned(
              [bunExe(), "build", "--compile", ...how, ...flags, main, "--outfile", executable],
              folder,
              bunEnv,
            );
            expect({ how, stderr: built.stderr, exitCode: built.exitCode }).toEqual({
              how,
              stderr: expect.any(String),
              exitCode: 0,
            });
            const ran = await spawned(
              [executable],
              folder,
              how.length ? { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" } : bunEnv,
            );
            expect({ how, stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
              how,
              stdout: prints,
              exitCode: 0,
              signal: null,
            });
          }
        }),
      600_000,
    );
  }
  for (const [what, flags] of Object.entries(rejected)) {
    test(
      "stops the build with an error: " + what,
      async () => {
        using dir = tempDir("aot-build-flags-rejected", { "main.ts": `console.log("ran");` });
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, "main.ts", "--outfile", join(String(dir), "program")],
          String(dir),
          bunEnv,
        );
        expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
          stderr: expect.stringContaining(`--aot does not support ${what}`),
          exitCode: 1,
        });
      },
      60_000,
    );
  }
});
