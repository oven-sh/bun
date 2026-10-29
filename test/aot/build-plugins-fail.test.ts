// Plugins of `Bun.build` that throw, reject or answer nonsense: the build fails with the message of the plugin, with
// `compile: { aot: true }` as without `aot`: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

const files = { "main.ts": `import { a } from "./a"; console.log(a);`, "a.ts": `export const a = 1;` };

buildBothWays("compile/aot/plugins of Bun.build that fail", {
  "onLoad throws": {
    files,
    plugins: [`build.onLoad({ filter: /a\\.ts$/ }, () => { throw new Error("onLoad gave up"); });`],
    fails: "onLoad gave up",
  },
  "onLoad rejects": {
    files,
    plugins: [
      `build.onLoad({ filter: /a\\.ts$/ }, async () => { await Bun.sleep(10); throw new TypeError("onLoad gave up late"); });`,
    ],
    fails: "onLoad gave up late",
  },
  "onLoad throws what is no error": {
    files,
    plugins: [`build.onLoad({ filter: /a\\.ts$/ }, () => { throw "a bare string"; });`],
    fails: "a bare string",
  },
  "onResolve throws": {
    files,
    plugins: [`build.onResolve({ filter: /^\\.\\/a$/ }, () => { throw new Error("onResolve gave up"); });`],
    fails: "onResolve gave up",
  },
  "onResolve rejects": {
    files,
    plugins: [
      `build.onResolve({ filter: /^\\.\\/a$/ }, async () => { await Bun.sleep(10); throw new RangeError("onResolve gave up late"); });`,
    ],
    fails: "onResolve gave up late",
  },
  "onLoad of the entry point throws": {
    files,
    plugins: [`build.onLoad({ filter: /main\\.ts$/ }, () => { throw new Error("no entry"); });`],
    fails: "no entry",
  },
  "onResolve of the entry point throws": {
    files,
    plugins: [`build.onResolve({ filter: /main/ }, () => { throw new Error("no entry"); });`],
    fails: "no entry",
  },
  "setup throws": { files, plugins: [`throw new Error("setup gave up");`], fails: "setup gave up" },
  "setup rejects late": {
    files,
    plugins: [`await Bun.sleep(10); throw new Error("setup gave up late");`],
    fails: "setup gave up late",
  },
  "onStart throws": {
    files,
    plugins: [`build.onStart(() => { throw new Error("onStart gave up"); });`],
    fails: "onStart gave up",
  },
  "onStart rejects": {
    files,
    plugins: [`build.onStart(async () => { await Bun.sleep(10); throw new Error("onStart gave up late"); });`],
    fails: "onStart gave up late",
  },
  "onEnd throws": {
    files,
    plugins: [`build.onEnd(() => { throw new Error("onEnd gave up"); });`],
    fails: "onEnd gave up",
  },
  "onEnd rejects": {
    files,
    plugins: [`build.onEnd(async () => { await Bun.sleep(10); throw new Error("onEnd gave up late"); });`],
    fails: "onEnd gave up late",
  },
  "onEnd sees a failed build": {
    files: { "main.ts": `// @ts-ignore\nimport { a } from "./missing"; console.log(a);` },
    plugins: [
      `build.onEnd((result: any) => tell("onEnd", { success: result.success, outputs: result.outputs.length, hasLogs: result.logs.length > 0 }));`,
    ],
    fails: "missing",
  },
  "contents of a wrong type": {
    files,
    plugins: [`build.onLoad({ filter: /a\\.ts$/ }, () => ({ contents: 42, loader: "ts" }));`],
    fails: "contents",
  },
  "a loader that does not exist": {
    files,
    plugins: [`build.onLoad({ filter: /a\\.ts$/ }, () => ({ contents: "", loader: "nonsense" }));`],
    fails: "nonsense",
  },
  "the object loader without exports": {
    files,
    plugins: [`build.onLoad({ filter: /a\\.ts$/ }, () => ({ loader: "object" }));`],
    fails: "exports",
  },
  "exports that JSON cannot hold": {
    files,
    plugins: [
      `build.onLoad({ filter: /a\\.ts$/ }, () => { const loop: any = {}; loop.loop = loop; return { exports: loop, loader: "object" }; });`,
    ],
    fails: "JSON",
  },
  "a path of a wrong type": {
    files,
    plugins: [`build.onResolve({ filter: /^\\.\\/a$/ }, () => ({ path: 42 }));`],
    fails: "path",
  },
  "text that does not parse": {
    files,
    plugins: [`build.onLoad({ filter: /a\\.ts$/ }, () => ({ contents: "export const a = ;", loader: "ts" }));`],
    fails: "",
  },
  "JSON that does not parse": {
    files: { "main.ts": `import a from "./a.json"; console.log(a);`, "a.json": "{}" },
    plugins: [`build.onLoad({ filter: /a\\.json$/ }, () => ({ contents: "{ nonsense", loader: "json" }));`],
    fails: "",
  },
  "a name that the text of the plugin does not export": {
    files,
    plugins: [`build.onLoad({ filter: /a\\.ts$/ }, () => ({ contents: "export const b = 1;", loader: "ts" }));`],
    fails: "",
  },
  "one of two plugins throws, in a module that nothing needs at run time": {
    files: {
      "main.ts": `import "./a"; import "./b"; console.log("main");`,
      "a.ts": `export {};`,
      "b.ts": `export {};`,
    },
    plugins: [
      `build.onLoad({ filter: /a\\.ts$/ }, () => ({ contents: "export {};", loader: "ts" }));`,
      `build.onLoad({ filter: /b\\.ts$/ }, () => { throw new Error("the second gave up"); });`,
    ],
    fails: "the second gave up",
  },
  "defer that is never followed by an answer": {
    files,
    plugins: [
      `build.onLoad({ filter: /a\\.ts$/ }, async (args: any) => { await args.defer(); throw new Error("gave up behind defer"); });`,
    ],
    fails: "gave up behind defer",
  },
  "a filter that is no regular expression": {
    files,
    plugins: [`build.onLoad({ filter: "a" }, () => undefined);`],
    fails: "filter",
  },
});
