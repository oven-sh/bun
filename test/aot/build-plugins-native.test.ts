// Native plugins of `Bun.build` (onBeforeParse) with `compile: { aot: true }` and without `aot`: build-both-ways.ts.
// ./build-plugins-native/shout.c is built with the system's C compiler against the headers in src/runtime/napi, without node-gyp.
import { afterAll, beforeAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, isWindows, tempDir } from "harness";
import { join, resolve } from "path";
import { buildBothWays } from "./build-both-ways";
import { spawned } from "./run-programs";

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
if (!systemCC || isWindows)
  console.error(
    "SKIPPED: test/aot/build-plugins-native.test.ts: it needs a C compiler ($CC, cc, gcc or clang), and is not written for Windows",
  );
else {
  const folder = String(tempDir("aot-build-plugins-native", {}));
  const addon = join(folder, "shout.node");
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  beforeAll(async () => {
    const compile = await spawned(
      [
        systemCC,
        "-shared",
        "-fPIC",
        ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
        "-I" + resolve(import.meta.dir, "../../src/runtime/napi"),
        "-I" + resolve(import.meta.dir, "../../packages/bun-native-bundler-plugin-api"),
        join(import.meta.dir, "build-plugins-native", "shout.c"),
        "-o",
        addon,
      ],
      folder,
      bunEnv,
    );
    expect({ stderr: compile.stderr, exitCode: compile.exitCode }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });
  });

  const napiModule = `const napiModule = require(${JSON.stringify(addon)});`;
  const files = {
    "main.ts": `import { a } from "./a"; import text from "./note.txt"; console.log("quiet main", a, text);`,
    "a.ts": `export const a: string = "quiet a";`,
    "note.txt": "quiet text",
    "types.d.ts": `declare module "*.txt" { const text: string; export default text; }`,
  };

  buildBothWays("compile/aot/native plugins of Bun.build", {
    "onBeforeParse changes the text of the files that match": {
      files,
      plugins: [`${napiModule} build.onBeforeParse({ filter: /a\\.ts$/ }, { napiModule, symbol: "shout" });`],
      prints: "quiet main LOUD! a quiet text\n",
    },
    "onBeforeParse for every file": {
      files,
      plugins: [`${napiModule} build.onBeforeParse({ filter: /.*/ }, { napiModule, symbol: "shout" });`],
    },
    "onBeforeParse gets the text that onLoad yields": {
      files,
      plugins: [
        `${napiModule} build.onBeforeParse({ filter: /a\\.ts$/ }, { napiModule, symbol: "shout" });
build.onLoad({ filter: /a\\.ts$/ }, () => ({ contents: 'export const a: string = "quiet from onLoad";', loader: "ts" }));`,
      ],
    },
    "onBeforeParse in a namespace": {
      files: { "main.ts": `// @ts-ignore\nimport { a } from "virtual:a"; console.log(a);` },
      plugins: [
        `${napiModule} build.onBeforeParse({ filter: /.*/, namespace: "virtual" }, { napiModule, symbol: "shout" });
build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: 'export const a = "quiet virtual";', loader: "js" }));`,
      ],
    },
    "the external value, and how many files the plugin sees": {
      files,
      plugins: [
        `${napiModule} const external = napiModule.createCounter();
build.onBeforeParse({ filter: /\\.ts$/ }, { napiModule, symbol: "count", external });
build.onEnd(() => tell("onEnd", { seen: napiModule.readCounter(external) }));`,
      ],
      prints: "LOUD! main LOUD! a quiet text\n",
    },
    "the loader napi: an addon whose bytes onLoad yields": {
      files: {
        "main.ts": `// @ts-nocheck\nimport addon from "virtual:addon.node"; const required = require("./empty.node"); const counter = addon.createCounter(); console.log(typeof addon.createCounter, addon.readCounter(counter), typeof required.readCounter);`,
        "empty.node": "",
      },
      plugins: [
        `const bytes = () => ({ contents: require("fs").readFileSync(${JSON.stringify(addon)}), loader: "napi" });
build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, bytes);
build.onLoad({ filter: /empty\\.node$/ }, (args: any) => { tell("onLoad", args); return bytes(); });`,
      ],
      prints: "function 0 function\n",
    },
    "an error that the native plugin logs": {
      files,
      plugins: [`${napiModule} build.onBeforeParse({ filter: /a\\.ts$/ }, { napiModule, symbol: "refuse" });`],
      fails: "the native plugin refuses this file",
    },
    "a symbol that the addon does not have": {
      files,
      plugins: [`${napiModule} build.onBeforeParse({ filter: /a\\.ts$/ }, { napiModule, symbol: "missing" });`],
      fails: "missing",
    },
  });
}
