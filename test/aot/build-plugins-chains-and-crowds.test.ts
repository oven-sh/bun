// Plugins of `Bun.build` that decline in every way there is, hooks that are asked about hundreds of modules, and onEnd in all its
// outcomes, with `compile: { aot: true }` and without `aot`: build-both-ways.ts.
import { buildBothWays } from "./build-both-ways";

const declines = [
  "null",
  "undefined",
  "false",
  "0",
  '""',
  "42",
  '"text"',
  "Symbol()",
  "Promise.resolve(null)",
  "Promise.resolve()",
];

const many = 200;
const crowd = Object.fromEntries(
  Array.from({ length: many }, (_, index) => [`part${index}.ts`, `export const part${index}: number = 0;`]),
);

buildBothWays("compile/aot/chains and crowds of plugins of Bun.build", {
  ...Object.fromEntries(
    declines.map(value => [
      `onResolve and onLoad answer ${value}: the next one is asked`,
      {
        files: {
          "main.ts": `import { a } from "./a"; console.log(a);`,
          "a.ts": `export const a = "disk";`,
          "b.ts": `export const a = "b on the disk";`,
        },
        plugins: [
          `build.onResolve({ filter: /^\\.\\/a$/ }, (args: any) => { tell("first onResolve", args); return ${value}; });
build.onLoad({ filter: /b\\.ts$/ }, (args: any) => { tell("first onLoad", args); return ${value}; });`,
          `build.onResolve({ filter: /^\\.\\/a$/ }, (args: any) => { tell("second onResolve", args); return { path: join(folder, "b.ts") }; });
build.onLoad({ filter: /b\\.ts$/ }, (args: any) => { tell("second onLoad", args); return { contents: 'export const a = "second";', loader: "ts" }; });`,
        ],
        prints: "second\n",
      },
    ]),
  ),
  "every plugin declines: the file on the disk": {
    files: { "main.ts": `import { a } from "./a"; console.log(a);`, "a.ts": `export const a = "disk";` },
    plugins: [
      `build.onResolve({ filter: /a/ }, () => undefined); build.onLoad({ filter: /a/ }, () => undefined);`,
      `build.onResolve({ filter: /a/ }, () => null); build.onLoad({ filter: /a/ }, async () => null);`,
    ],
    prints: "disk\n",
  },
  "an answer without a path declines": {
    files: { "main.ts": `import { a } from "./a"; console.log(a);`, "a.ts": `export const a = "disk";` },
    plugins: [
      `build.onResolve({ filter: /^\\.\\/a$/ }, () => ({ namespace: "nowhere" }));`,
      `build.onResolve({ filter: /^\\.\\/a$/ }, () => ({ path: "" }));`,
    ],
    prints: "disk\n",
  },
  "the entry point, where every plugin declines": {
    files: { "main.ts": `console.log("main");` },
    plugins: [
      `build.onResolve({ filter: /main/ }, (args: any) => { tell("first", args); return null; });`,
      `build.onResolve({ filter: /main/ }, (args: any) => { tell("second", args); });`,
    ],
    prints: "main\n",
  },
  "two hundred files through onResolve and onLoad": {
    files: {
      "main.ts":
        Array.from({ length: many }, (_, index) => `import { part${index} } from "./part${index}";`).join("\n") +
        `\nconsole.log(${Array.from({ length: many }, (_, index) => `part${index}`).join(" + ")});`,
      ...crowd,
    },
    plugins: [
      `let resolved = 0, loaded = 0;
build.onResolve({ filter: /^\\.\\/part/ }, async (args: any) => { resolved++; if (resolved % 3 === 0) await Bun.sleep(1); return { path: join(folder, args.path.slice(2) + ".ts") }; });
build.onLoad({ filter: /part\\d+\\.ts$/ }, async (args: any) => { loaded++; const index = Number(/\\d+/.exec(basename(args.path))![0]); if (index % 5 === 0) await Bun.sleep(1); return { contents: "export const part" + index + ": number = " + index + ";", loader: "ts" }; });
build.onEnd(() => tell("onEnd", { resolved, loaded }));`,
    ],
    prints: (many * (many - 1)) / 2 + "\n",
  },
  "two hundred modules in a namespace, each importing the next": {
    files: { "main.ts": `// @ts-ignore\nimport { total } from "chain:0"; console.log(total);` },
    plugins: [
      `build.onResolve({ filter: /^chain:/ }, (args: any) => ({ path: args.path.slice(6), namespace: "chain" }));
build.onLoad({ filter: /.*/, namespace: "chain" }, (args: any) => { const index = Number(args.path); return { contents: index + 1 < ${many} ? 'import { total as next } from "chain:' + (index + 1) + '"; export const total = next + ' + index + ";" : "export const total = " + index + ";", loader: "js" }; });`,
    ],
    prints: (many * (many - 1)) / 2 + "\n",
  },
  "a file that many files import is loaded once": {
    files: {
      "main.ts": `import { a } from "./a"; import { b } from "./b"; import { shared } from "./shared"; console.log(a, b, shared);`,
      "a.ts": `import { shared } from "./shared"; export const a = shared;`,
      "b.ts": `import { shared } from "./shared.ts"; export const b = shared; export const late = () => import("./shared");`,
      "shared.ts": `export const shared = 0;`,
    },
    plugins: [
      `let loads = 0; build.onLoad({ filter: /shared\\.ts$/ }, () => ({ contents: "export const shared = " + ++loads + ";", loader: "ts" })); build.onEnd(() => tell("onEnd", { loads }));`,
    ],
    prints: "1 1 1\n",
  },
  "several files with the loader file": {
    files: {
      "main.ts": `// @ts-nocheck\nimport a from "./a.png"; import b from "./b.png"; import same from "./same.png"; console.log(await Bun.file(a).text(), await Bun.file(b).text(), await Bun.file(same).text(), a === b, a === same);`,
      "a.png": "disk a",
      "b.png": "disk b",
      "same.png": "disk same",
    },
    plugins: [
      `build.onLoad({ filter: /\\.png$/ }, (args: any) => ({ contents: basename(args.path) === "b.png" ? "plugin b" : "plugin a", loader: "file" }));`,
    ],
  },
  "onEnd: every callback runs, in order, also behind one that throws": {
    files: { "main.ts": `console.log("main");` },
    plugins: [
      `build.onEnd(() => tell("first onEnd")); build.onEnd(() => { tell("second onEnd"); throw new Error("the second gave up"); }); build.onEnd(async () => { await Bun.sleep(5); tell("third onEnd"); });`,
      `build.onEnd(() => { tell("fourth onEnd"); return Promise.reject(new Error("the fourth gave up")); });`,
    ],
    fails: "gave up",
  },
  "onEnd of a build that fails, with throw: true": {
    files: { "main.ts": `// @ts-ignore\nimport "./missing"; console.log("main");` },
    plugins: [
      `build.onEnd((result: any) => tell("onEnd", { success: result.success, outputs: result.outputs.length }));`,
    ],
    options: `throw: true`,
    fails: "Bun.build rejected",
  },
  "onEnd may write beside the executable": {
    files: { "main.ts": `declare const Bun: any; console.log(await Bun.file("written-by-on-end.txt").text());` },
    plugins: [
      `build.onEnd(async (result: any) => { await Bun.write(join(folder, "written-by-on-end.txt"), "outputs: " + result.outputs.length); });`,
    ],
    prints: "outputs: 1\n",
  },
  "the executable is there when onEnd runs": {
    files: { "main.ts": `console.log("main");` },
    plugins: [
      `build.onEnd(async (result: any) => tell("onEnd", { exists: await Bun.file(result.outputs[0].path).exists(), isOutfile: result.outputs[0].path === outfile, large: result.outputs[0].size > 1_000_000 }));`,
    ],
    prints: "main\n",
  },
});
