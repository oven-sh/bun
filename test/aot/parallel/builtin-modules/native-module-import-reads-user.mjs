// User-defined accessors on process, on the node:module constructor and on globalThis record how often, and between which microtasks, loading a native built-in module reads them: once, on the first import(). require() of node:process and node:module returns the object without reading anything; require() of node:buffer builds its own result once.
// Alone: the output depends on which built-in modules were loaded earlier in the same executable
const log = [];
const show = what => {
  console.log(what + ":", log.join(" ") || "nothing");
  log.length = 0;
};
const watch = (holder, key, value) =>
  Object.defineProperty(holder, key, {
    get() {
      log.push(key);
      return value;
    },
    enumerable: true,
    configurable: true,
  });
const made = text => text.split("").join("");
const queueJobs = () => {
  let last = Promise.resolve();
  for (let job = 1; job <= 16; job++)
    last = last.then(() => {
      log.push("j" + job);
    });
  return last;
};
async function load(what, start) {
  const jobs = queueJobs();
  const loading = start();
  log.push("called");
  const loaded = await loading;
  log.push("loaded");
  await jobs;
  show(what);
  return loaded;
}

watch(process, "custom", 1);
watch(process, "title", "a title");
console.log(require("node:process") === process, require(made("process")) === process, process.getBuiltinModule("node:process") === process);
show("require of node:process");
const ofProcess = await load("import of node:process", () => import("node:process"));
console.log(ofProcess.custom, ofProcess.title, ofProcess.default === process);
show("reads of its exports");
console.log((await import(made("node:process"))) === ofProcess, (await import("node:" + ["process"][0])) === ofProcess, (await import("process")) === ofProcess);
console.log(require("node:process") === process);
show("later loads of node:process");

const Module = require("node:module");
watch(Module, "builtinModules", 2);
watch(Module, "custom", 3);
console.log(require(made("node:module")) === Module, process.getBuiltinModule("module") === Module);
show("require of node:module");
const ofModule = await load("import of node:module", () => import("node:" + ["module"][0]));
console.log(ofModule.builtinModules, ofModule.custom, ofModule.default === Module);
console.log((await import("node:module")) === ofModule, (await import(made("module"))) === ofModule);
show("later loads of node:module");

watch(globalThis, "atob", 4);
watch(globalThis, "btoa", 5);
const ofBuffer = await load("import of node:buffer", () => import("node:buffer"));
console.log(ofBuffer.atob, ofBuffer.btoa);
console.log((await import(made("node:buffer"))) === ofBuffer, (await import("buffer")) === ofBuffer);
show("later imports of node:buffer");
console.log(require("node:buffer") === ofBuffer.default);
show("require of node:buffer");
console.log(require(made("node:buffer")) === ofBuffer.default, require("buffer") === ofBuffer.default);
show("later loads of node:buffer");
