// A compiled module is found by the exact bytes of its path: file names with a space or outside ASCII, loaded by relative path, absolute path and URL, named in stacks, listed in require.cache and deleted from it. One file that is only on disk is loaded too: the build has --compile-inspector, so the executable loads code that is not in it.
// Flags: --compile-inspector
// Todo: It gets a fresh copy of a module by deleting the module from require.cache. That does nothing in an executable, where a module runs once. It needs a file of its own for each case.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const runs = (globalThis.runs = {});
const absolute = name => path.join(__dirname, name);

function relativeName(file) {
  if (typeof file !== "string") return String(file);
  if (file === __filename) return "(entry)";
  return path.relative(__dirname, file).replaceAll("\\", "/") || ".";
}

function cachedFiles() {
  const keys = Object.keys(require.cache).filter(key => key.startsWith(__dirname + path.sep));
  return keys.map(relativeName).sort().join(", ");
}

const topFrameFile = error => /(?:\(|at )([^(]+):\d+:\d+\)?$/.exec(error.stack.split("\n")[1])?.[1];

const umlaut = {
  name: "ü-umlaut.js",
  byRequire: () => require("./ü-umlaut.js"),
  byImport: () => import("./ü-umlaut.js"),
};
const japanese = {
  name: "日本語/index.cjs",
  byRequire: () => require("./日本語/index.cjs"),
  byImport: () => import("./日本語/index.cjs"),
};
const space = {
  name: "a b.mjs",
  byRequire: () => require("./a b.mjs"),
  byImport: () => import("./a b.mjs"),
};
// No code reads this module's path, so the executable has it only in its module table.
const unread = {
  name: "ø-unread-path.mjs",
  byRequire: () => require("./ø-unread-path.mjs"),
  byImport: () => import("./ø-unread-path.mjs"),
};
const data = {
  name: "data.json",
  byRequire: () => require("./data.json"),
  byImport: () => import("./data.json"),
};
const files = [umlaut, japanese, space, unread, data];

function checkInitialCache() {
  console.log("cached at the start:", cachedFiles());
  for (const { name } of files) {
    console.log(name, "before it ran:", absolute(name) in require.cache, require.cache[absolute(name)]);
  }
  console.log("runs:", JSON.stringify(runs));
}

function requireByRelativePath() {
  for (const file of files) file.value = file.byRequire();
  console.log("runs:", JSON.stringify(runs));
  console.log("cached after require:", cachedFiles());
  for (const { name, value } of files) {
    console.log(name, "in require.cache:", require.cache[absolute(name)].exports === value);
  }
}

function checkPathsAndStacks() {
  for (const { name, value } of [umlaut, japanese, space]) {
    console.log(name, "says it is", relativeName(value.file), "in", relativeName(value.folder));
  }
  for (const { value } of [umlaut, japanese, space, unread]) {
    try {
      value.fail();
    } catch (error) {
      console.log(error.message + ", top frame in", relativeName(topFrameFile(error)));
    }
  }
}

async function loadByAbsolutePath() {
  for (const { name, value } of files) {
    console.log(name, "required by absolute path:", require(absolute(name)) === value);
  }
  for (const file of files) {
    file.namespace = await file.byImport();
    const byPath = await import(absolute(file.name));
    const byURL = await import(pathToFileURL(absolute(file.name)).href);
    console.log(file.name, "imported by absolute path, by URL:", byPath === file.namespace, byURL === file.namespace);
  }
  for (const { name, namespace, value } of [umlaut, japanese]) {
    console.log(name, "default is module.exports:", namespace.default === value);
  }
  for (const { name, namespace, value } of [space, unread]) {
    console.log(name, "require returns the namespace:", namespace === value);
  }
  console.log(data.name, "default:", JSON.stringify(data.namespace.default));
  console.log("runs:", JSON.stringify(runs));
}

function lookUpUnequalKeys() {
  const keys = files.flatMap(({ name }) => [
    [name + " in upper case", absolute(name.toUpperCase())],
    [name + " with a trailing slash", absolute(name) + "/"],
  ]);
  keys.push([umlaut.name + " decomposed", absolute(umlaut.name.normalize("NFD"))]);
  for (const [label, key] of keys) {
    console.log(label + ":", key in require.cache, require.cache[key], delete require.cache[key]);
  }
  const isUnchanged = files.every(file => file.byRequire() === file.value);
  console.log("nothing was evicted:", isUnchanged, JSON.stringify(runs));
}

async function importFromVMContext() {
  const file = space.value.file;
  try {
    await vm.runInNewContext("import(file)", { file });
    console.log("node:vm without a loader: imported");
  } catch (error) {
    console.log("node:vm without a loader:", error.code);
  }
  const options = { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER };
  const namespace = await vm.runInNewContext("import(file)", { file }, options);
  console.log("node:vm with the loader of the main context:", namespace === space.namespace);
}

async function loadUncompiledFile() {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "paths-and-cache-")));
  try {
    const file = path.join(folder, "on disk ü.cjs");
    fs.writeFileSync(file, "globalThis.runs.onDisk = (globalThis.runs.onDisk ?? 0) + 1;\nexports.file = __filename;\n");
    console.log("only on disk, before it ran:", file in require.cache, require.cache[file]);
    const value = require(file);
    console.log("only on disk:", path.basename(value.file), value.file === file, file in require.cache);
    console.log("loaded once:", require(file) === value, (await import(file)).default === value, runs.onDisk);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

function evictFromCache() {
  for (const { name } of [umlaut, japanese, data]) delete require.cache[absolute(name)];
  console.log("cached after delete:", cachedFiles());
  const hasNewExports = [umlaut, japanese].map(file => file.byRequire() !== file.value);
  console.log("CommonJS runs again:", hasNewExports.join(), runs.umlaut, runs.japanese);
  const parsedAgain = data.byRequire();
  console.log("JSON is parsed again:", parsedAgain !== data.value, JSON.stringify(parsedAgain));
  console.log("JSON is cached again:", data.byRequire() === parsedAgain);
  console.log("CommonJS is cached again:", umlaut.byRequire() === umlaut.byRequire(), runs.umlaut);
  console.log("cached at the end:", cachedFiles());
}

async function run() {
  checkInitialCache();
  requireByRelativePath();
  checkPathsAndStacks();
  await loadByAbsolutePath();
  lookUpUnequalKeys();
  await importFromVMContext();
  await loadUncompiledFile();
  evictFromCache();
}

run().catch(error => {
  console.log("failed:", error);
  process.exitCode = 1;
});
