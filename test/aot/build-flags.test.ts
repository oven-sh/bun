// The flags of `bun build` that change what the program does. Each program is built with `--compile` and with `--compile --aot` under the same
// flags, and both executables print what is written here. A flag that --aot does not support stops the build with an error.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./run-programs";

const packages = {
  "node_modules/cond/package.json": `{ "name": "cond", "version": "1.0.0", "exports": { "custom": "./custom.js", "default": "./default.js" } }`,
  "node_modules/cond/custom.js": `export default "custom";`,
  "node_modules/cond/default.js": `export default "default";`,
  "node_modules/mine/package.json": `{ "name": "mine", "version": "1.0.0", "exports": { "./jsx-runtime": "./r.js", "./jsx-dev-runtime": "./r.js" } }`,
  "node_modules/mine/r.js": `export const jsx = (t, p) => "mine:" + t + JSON.stringify(p); export const jsxs = jsx; export const jsxDEV = jsx; export const Fragment = "f";`,
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
  "--bytecode-depth": {
    flags: ["--bytecode", "--bytecode-depth=1"],
    files: { "main.ts": `function outer() { return function inner() { return "inner"; }; } console.log(outer()());` },
    prints: "inner\n",
  },
  "--bytecode-order": {
    flags: ["--bytecode", "--bytecode-order=app.order"],
    files: { "main.ts": `console.log("ordered");`, "app.order": "" },
    prints: "ordered\n",
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
const say = (text: unknown) => void process.stdout.write(String(text) + "\\n");
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
const held = console;
held.table = () => say("through another name it is called");
held.table();
say((console as any).log("as a test") ? "never" : "the arm for undefined");
import("./other").then(other => other.run());`,
      "other.ts": `export function run() { console.log("dropped in every file"); process.stdout.write("other ran\\n"); }`,
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
          const main = Object.keys(files).find(file => file.startsWith("main."))!;
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
  test(
    "Bun.build: drop",
    () =>
      slot(async () => {
        using dir = tempDir("aot-build-drop", {
          "main.ts": `console.log("dropped"); process.stdout.write("kept\\n");`,
          "build.ts": `const built = await Bun.build({ entrypoints: ["./main.ts"], drop: ["console"], compile: { outfile: "./program", aot: true } }); process.stdout.write(String(built.success));`,
        });
        const built = await spawned([bunExe(), "build.ts"], String(dir), bunEnv);
        expect({ stdout: built.stdout, stderr: built.stderr, exitCode: built.exitCode }).toEqual({
          stdout: "true",
          stderr: expect.any(String),
          exitCode: 0,
        });
        const ran = await spawned([join(String(dir), isWindows ? "program.exe" : "program")], String(dir), {
          ...bunEnv,
          BUN_JSC_crashIfInterpreterIsUsed: "1",
        });
        expect({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
          stdout: "kept\n",
          exitCode: 0,
          signal: null,
        });
      }),
    600_000,
  );
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
