// User-defined accessors that native built-in modules read while they are generated show between which microtasks of the program that happens: two after the loader requests the module, whatever the depth of the file that imports it, and before any file of the graph runs.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: the steps depend on which built-in modules were imported earlier in the process
const log = [];
globalThis.note = text => log.push(text);
const watch = (holder, key) =>
  Object.defineProperty(holder, key, {
    get() {
      note("[" + key + "]");
      return key;
    },
    enumerable: true,
    configurable: true,
  });
watch(process, "custom");
watch(globalThis, "atob");
watch(require("node:module"), "builtinModules");
if (process.argv.length > 7) console.log(process.custom, globalThis.atob, require("node:module").builtinModules);
const load = async (what, start) => {
  let jobs = Promise.resolve();
  for (let job = 1; job <= 30; job++)
    jobs = jobs.then(() => {
      log.push(job);
    });
  await start().then(
    () => note("settled"),
    error => note("rejected: " + error.message),
  );
  await jobs;
  console.log(what + ":", log.join(" "));
  log.length = 0;
};
await load("one level down", () => import("./one.mjs"));
await load("two levels down", () => import("./two.mjs"));
await load("three levels down, beside one that is loaded", () => import("./three.mjs"));
await load("all of them again", () => import("./again.mjs"));
