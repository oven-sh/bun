// Graphs import CommonJS files that queue jobs, and a module that is not there or does not parse. The files that the loader comes to run, and their jobs with them; no other file of the graph runs.
// Flags: --external ./absent.mjs
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import { createRequire } from "node:module";

globalThis.note = text => console.log("  " + text);
globalThis.runFile = name => {
  note(name + " runs");
  Promise.resolve().then(() => note("job of " + name));
};

const graphs = {
  "a file, then the absent module": () => import("./file-first.mjs"),
  "the absent module, then a file": () => import("./absent-first.mjs"),
  "the absent module between two files": () => import("./absent-between.mjs"),
  "a file below a module, then the absent module": () => import("./file-below.mjs"),
  "the absent module and a file, both below a module": () => import("./absent-below.mjs"),
  "the absent module, then a file without a job": () => import("./absent-before-quiet.mjs"),
  "a job waits beside the load": () => {
    const load = import("./beside-a-job.mjs");
    Promise.resolve().then(() => note("job beside the load"));
    return load;
  },
  "a text that does not parse": () => import("./broken-text.mjs"),
  "the same text once more, then a file": () => import("./broken-text-first.mjs"),
  "the first graph once more": () => import("./file-first.mjs"),
  "its file and another one, and nothing is absent": () => import("./nothing-absent.mjs"),
  "a file, then the absent module, by require()": async () => createRequire(import.meta.url)("./required.mjs"),
};

for (const [name, load] of Object.entries(graphs)) {
  console.log(name);
  try {
    await load();
    note("loaded");
  } catch (error) {
    note("rejected: " + error.name);
  }
  await new Promise(resolve => setTimeout(resolve, 1));
}
