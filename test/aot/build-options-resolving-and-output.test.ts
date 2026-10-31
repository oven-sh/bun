// The options of `Bun.build` that change which files a program has and what is written, alone and together with plugins, with
// `compile: { aot: true }` and without `aot`: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

const tellEverything = `build.onResolve({ filter: /.*/ }, (args: any) => void tell("onResolve", args));
build.onLoad({ filter: /.*/ }, (args: any) => void tell("onLoad", args));`;

buildBothWays("compile/aot/options of Bun.build: resolving and output", {
  "conditions": {
    files: {
      "main.ts": `import { which } from "pkg"; import { sub } from "pkg/sub"; console.log(which, sub, require("pkg").which);\ndeclare const require: any;`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        exports: {
          ".": {
            custom: { import: "./custom.mjs", require: "./custom.cjs" },
            bun: "./bun.js",
            default: "./default.js",
          },
          "./sub": { other: "./other.js", custom: "./sub-custom.js", default: "./default.js" },
        },
      }),
      "node_modules/pkg/index.d.ts": `export const which: string, sub: string;`,
      "node_modules/pkg/custom.mjs": `export const which = "custom import";`,
      "node_modules/pkg/custom.cjs": `exports.which = "custom require";`,
      "node_modules/pkg/bun.js": `export const which = "bun";`,
      "node_modules/pkg/default.js": `export const which = "default", sub = "default";`,
      "node_modules/pkg/other.js": `export const sub = "other";`,
      "node_modules/pkg/sub-custom.js": `export const sub = "sub custom";`,
      "types.d.ts": `declare module "pkg" { export const which: string; } declare module "pkg/sub" { export const sub: string; }`,
    },
    options: `conditions: ["custom"]`,
    plugins: [tellEverything],
    prints: "custom import sub custom custom require\n",
  },
  "paths of the tsconfig": {
    files: {
      "main.ts": `import { a } from "@lib/a"; import { b } from "exact"; import { c } from "based/c"; console.log(a, b, c);`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "preserve",
          moduleResolution: "bundler",
          types: [],
          baseUrl: ".",
          paths: { "@lib/*": ["./src/lib/*"], exact: ["./src/exact.ts"] },
        },
        exclude: ["build.ts"],
      }),
      "src/lib/a.ts": `export const a = "a";`,
      "src/exact.ts": `export const b = "b";`,
      "based/c.ts": `export const c = "c";`,
    },
    plugins: [tellEverything],
    prints: "a b c\n",
  },
  "another tsconfig": {
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
        exclude: ["build.ts"],
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "preserve",
          moduleResolution: "bundler",
          types: [],
          paths: { "@lib/*": ["./usual/*"] },
        },
        exclude: ["build.ts"],
      }),
      "other/a.ts": `export const a = "other";`,
      "usual/a.ts": `export const a = "usual";`,
    },
    options: `tsconfig: "./other.json"`,
    prints: "other\n",
  },
  "external": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { a } from "outside-pkg"; import { b } from "./outside.mjs"; import { c } from "star/anything"; console.log(a, b, c);`,
      "outside.mjs": `export const b = "file at run time";`,
      "node_modules/outside-pkg/package.json": `{ "name": "outside-pkg", "version": "1.0.0", "main": "./index.js" }`,
      "node_modules/outside-pkg/index.js": `exports.a = "package at run time";`,
      "node_modules/star/package.json": `{ "name": "star", "version": "1.0.0" }`,
      "node_modules/star/anything.js": `exports.c = "pattern at run time";`,
    },
    options: `external: ["outside-pkg", "./outside.mjs", "star/*"]`,
    plugins: [tellEverything],
    interprets: true,
  },
  "packages: external": {
    files: {
      "main.ts": `// @ts-nocheck\nimport { a } from "pkg"; import { b } from "./inside"; console.log(a, b);`,
      "inside.ts": `export const b = "inside";`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "./index.js" }`,
      "node_modules/pkg/index.js": `exports.a = "package at run time";`,
    },
    options: `packages: "external"`,
    plugins: [tellEverything],
    interprets: true,
  },
  "drop: all of console": {
    files: { "main.ts": `console.log("dropped"); const held = console; held.log("kept");` },
    options: `drop: ["console"]`,
    prints: "kept\n",
  },
  "features": {
    files: {
      "main.ts": `import { feature } from "bun:bundle"; if (feature("ON")) console.log("on"); else console.log("not on"); if (feature("OFF")) { console.log("off is on"); require("./never"); } console.log(feature("ON") ? 1 : 2, feature("OFF") ? 1 : 2);\ndeclare const require: any;`,
      "types.d.ts": `declare module "bun:bundle" { export function feature(name: string): boolean; }`,
    },
    options: `features: ["ON"]`,
    plugins: [tellEverything],
    prints: "on\n1 2\n",
  },
  "sourcemap": {
    files: {
      "main.ts": `import { fail } from "./fail";\ntry { fail(); } catch (error: any) { console.log(error.stack.split("\\n").slice(0, 3).map((line: string) => line.replace(/[^ (]*[\\\\/]/, "")).join("|")); }`,
      "fail.ts": `// a line\n// another line\nexport function fail(): never {\n  throw new Error("failed");\n}`,
    },
    options: `sourcemap: "inline"`,
    // The positions are in the executable: there is no map beside it.
    differs: { outputs: ["entry-point"] },
  },
  "sourcemap: positions in the text that a plugin yields": {
    files: {
      "main.ts": `import { fail } from "./fail";\ntry { fail(); } catch (error: any) { console.log(error.stack.split("\\n").slice(0, 3).map((line: string) => line.replace(/[^ (]*[\\\\/]/, "")).join("|")); }`,
      "fail.ts": `export function fail(): never { throw new Error("disk"); }`,
    },
    options: `sourcemap: "inline"`,
    differs: { outputs: ["entry-point"] },
    plugins: [
      `build.onLoad({ filter: /fail\\.ts$/ }, () => ({ contents: "\\n\\n\\n\\n\\nexport function fail(): never {\\n      throw new Error('plugin');\\n}", loader: "ts" }));`,
    ],
  },
  "minify": {
    files: {
      "main.ts": `function longName(value: number) { return value * 2; } class Named {} console.log(longName(21), longName.name, Named.name, (() => {}).name);`,
    },
    options: `minify: true`,
    prints: "42 n e \n",
    // A binding that a bundle renames is shown under a short name here too. Which one is the compiler's own choice, not the bundle's.
    differs: { stdout: expect.stringMatching(/^42 [A-Za-z_$]{1,3} [A-Za-z_$]{1,3} \n$/) },
  },
  "jsx": {
    files: {
      "main.tsx": `// @ts-nocheck\nconsole.log(JSON.stringify(<a href="x"><b>t</b></a>));`,
      "node_modules/custom/package.json": `{ "name": "custom", "version": "1.0.0", "exports": { "./jsx-runtime": "./runtime.js", "./jsx-dev-runtime": "./runtime.js" } }`,
      "node_modules/custom/runtime.js": `export function jsx(type, props) { return { custom: type, ...props }; } export const jsxs = jsx, jsxDEV = jsx, Fragment = "f";`,
    },
    options: `entrypoints: ["./main.tsx"], jsx: { runtime: "automatic", importSource: "custom" }`,
    plugins: [tellEverything],
  },
  "several entry points": {
    alone: true,
    files: {
      "main.ts": `console.log("main", (await import("./second")).name);`,
      "second.ts": `export const name = "second"; console.log("second runs");`,
    },
    options: `entrypoints: ["./main.ts", "./second.ts"]`,
    plugins: [tellEverything],
  },
  "root and naming": {
    files: {
      "src/app/main.ts": `import path from "./asset.bin" with { type: "file" }; console.log(path.replaceAll("\\\\", "/").split("/").slice(-2).join("/").replace(/-[a-z0-9]+\\./, "-hash."));`,
      "src/app/asset.bin": "asset",
      "types.d.ts": `declare module "*.bin" { const path: string; export default path; }`,
    },
    options: `entrypoints: ["./src/app/main.ts"], root: "./src"`,
  },
  "format cjs": {
    files: {
      "main.ts": `import { a } from "./a"; console.log("main", a, typeof require, import.meta.main);`,
      "a.ts": `export const a = 1;`,
    },
    options: `format: "cjs"`,
    prints: "main 1 function true\n",
  },
});
