// A CommonJS file that a graph imports runs while the graph is being loaded. What the file asks of the loader then stands among the steps of that load:
// under require() they are all taken before require() returns, under an import they are jobs among the jobs of the program, and so are the steps that run the files behind it.
// (who loads the graph) x (where the file stands in it) x (what the file imports) x (what else waits)

const says = (text: string) => `console.log(${JSON.stringify(text)});\n`;
// It names `module`, so it is CommonJS whoever loads it.
const fileThatSays = (text: string) => says(text) + "module.exports = {};\n";
const chain = (name: string, length: number) =>
  `{\n  let last = Promise.resolve();\n  for (let turn = 0; turn < ${length}; turn++) last = last.then(() => console.log("${name}", turn));\n}\n`;

export const loaders = {
  "a CommonJS entry point requires the graph": {
    file: "main.cjs",
    text: `try {\n  console.log("main", require("./root.mjs").value);\n} catch (error) {\n  console.log("main caught", error.name);\n}\n${says("main ends")}`,
  },
  "an ES module requires the graph": {
    file: "main.mjs",
    text: `import { createRequire } from "node:module";\nconsole.log("main", createRequire(import.meta.url)("./root.mjs").value);\n${says("main ends")}`,
  },
  "a required CommonJS file requires the graph": {
    file: "main.cjs",
    text: `require("./between.cjs");\n${says("main ends")}`,
    files: {
      "between.cjs": `console.log("between", require("./root.mjs").value);\n${says("between ends")}`,
    },
  },
  "a job requires the graph": {
    file: "main.cjs",
    text: `Promise.resolve().then(() => {\n  console.log("job", require("./root.mjs").value);\n  ${says("job ends")}});\n${says("main ends")}`,
  },
  "the entry point imports the graph": {
    file: "main.mjs",
    text: `import { value } from "./root.mjs";\nconsole.log("main", value);\n${says("main ends")}`,
  },
  "an import call loads the graph": {
    file: "main.mjs",
    text: `const { value } = await import("./root.mjs");\nconsole.log("main", value);\n${says("main ends")}`,
  },
} satisfies Record<string, { file: string; text: string; files?: Record<string, string> }>;

export const places = {
  "the root imports the file": {
    "root.mjs": `import { v } from "./file.cjs";\n${says("root runs")}export const value = v;\n`,
  },
  "a module below the root imports the file": {
    "root.mjs": `import { v } from "./low.mjs";\n${says("root runs")}export const value = v;\n`,
    "low.mjs": `export { v } from "./file.cjs";\n${says("low runs")}`,
  },
  "the file stands between two other files": {
    "root.mjs": `import "./first.cjs";\nimport { v } from "./file.cjs";\nimport "./last.cjs";\n${says("root runs")}export const value = v;\n`,
    "first.cjs": fileThatSays("first runs"),
    "last.cjs": fileThatSays("last runs"),
  },
  "a module and its file stand behind the file": {
    "root.mjs": `import { v } from "./file.cjs";\nimport "./side.mjs";\n${says("root runs")}export const value = v;\n`,
    "side.mjs": `import "./last.cjs";\n${says("side runs")}`,
    "last.cjs": fileThatSays("last runs"),
  },
} satisfies Record<string, Record<string, string>>;

const settles = `.then(\n  () => ${says("imported").trim().slice(0, -1)},\n  error => console.log("rejected", error.name),\n);\n`;
export const asked = {
  "a module without imports": {
    call: `import("./asked.mjs")${settles}`,
    files: { "asked.mjs": says("asked runs") },
  },
  "a module that imports the file back": {
    call: `import("./asked.mjs")${settles}`,
    files: {
      "asked.mjs": `import { v } from "./file.cjs";\nconsole.log("asked runs", typeof v);\n`,
    },
  },
  "a graph of three levels": {
    call: `import("./asked.mjs")${settles}`,
    files: {
      "asked.mjs": `import "./asked-2.mjs";\n${says("asked runs")}`,
      "asked-2.mjs": `import "./asked-3.mjs";\n${says("asked-2 runs")}`,
      "asked-3.mjs": says("asked-3 runs"),
    },
  },
  "a module that imports another CommonJS file": {
    call: `import("./asked.mjs")${settles}`,
    files: {
      "asked.mjs": `import "./asked-file.cjs";\n${says("asked runs")}`,
      "asked-file.cjs": fileThatSays("asked-file runs"),
    },
  },
  "the root of the graph": {
    call: `import("./root.mjs")${settles}`,
    files: {},
  },
  "a module that awaits": {
    call: `import("./asked.mjs")${settles}`,
    files: {
      "asked.mjs": `${says("asked runs")}await 0;\n${says("asked goes on")}`,
    },
  },
  "a module that throws": {
    call: `import("./asked.mjs")${settles}`,
    files: {
      "asked.mjs": `${says("asked runs")}throw new TypeError("thrown");\n`,
    },
  },
  "a built-in module": { call: `import("node:path")${settles}`, files: {} },
  "a JSON file": {
    call: `import("./asked.json")${settles}`,
    files: { "asked.json": `{ "a": 1 }\n` },
  },
  "two modules": {
    call: `import("./asked.mjs")${settles}import("./asked-2.mjs")${settles}`,
    files: {
      "asked.mjs": says("asked runs"),
      "asked-2.mjs": says("asked-2 runs"),
    },
  },
} satisfies Record<string, { call: string; files: Record<string, string> }>;

const runsJobs = `require("bun:jsc").drainMicrotasks();\n${says("file goes on")}`;
export const watchers = {
  "nothing else waits": { before: "", behind: "" },
  "a job of the file waits": {
    before: "",
    behind: `Promise.resolve().then(() => ${says("job of the file").trim().slice(0, -1)});\n`,
  },
  "a chain begun in front of the call": {
    before: chain("before", 24),
    behind: "",
  },
  "a chain begun behind the call": { before: "", behind: chain("behind", 24) },
  "the file has the waiting jobs run": { before: "", behind: runsJobs },
  "a job of the file waits, and the file has the waiting jobs run": {
    before: "",
    behind: `Promise.resolve().then(() => ${says("job of the file").trim().slice(0, -1)});\n` + runsJobs,
  },
} satisfies Record<string, { before: string; behind: string }>;

export type Case = [keyof typeof loaders, keyof typeof places, keyof typeof asked, keyof typeof watchers];

export const cases: Case[] = [];
for (const loader of Object.keys(loaders) as Case[0][])
  for (const place of Object.keys(places) as Case[1][])
    for (const what of Object.keys(asked) as Case[2][])
      for (const watcher of Object.keys(watchers) as Case[3][])
        cases.push([loader, place, what, watcher]);

export const nameOf = (given: Case) => given.join(", ");

export function make([loader, place, what, watcher]: Case) {
  const {
    file,
    text,
    files = {},
  } = loaders[loader] as {
    file: string;
    text: string;
    files?: Record<string, string>;
  };
  return {
    file,
    text,
    files: {
      ...files,
      ...places[place],
      ...asked[what].files,
      "file.cjs":
        watchers[watcher].before +
        asked[what].call +
        watchers[watcher].behind +
        `exports.v = "v" + process.argv.length;\n${says("file ends")}`,
    },
  };
}
