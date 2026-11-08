// A compiled module is found by the exact bytes of its path: file names with a space or outside ASCII, loaded by relative path, absolute path and URL, and named in stacks.
// Flags: --compile-inspector
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const runs = (globalThis.runs = {});
const absolute = name => path.join(__dirname, name);

// An executable has its ES modules and its frames under a root of its own: the name of the file is what both have.
const nameOf = file => path.basename(String(file));

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

function requireByRelativePath() {
  for (const file of files) file.value = file.byRequire();
  console.log("runs:", JSON.stringify(runs));
}

function checkPathsAndStacks() {
  for (const { name, value } of [umlaut, japanese, space]) {
    console.log(name, "says it is", nameOf(value.file));
  }
  for (const { value } of [umlaut, japanese, space, unread]) {
    try {
      value.fail();
    } catch (error) {
      console.log(error.message + ", top frame in", nameOf(topFrameFile(error)));
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

async function run() {
  requireByRelativePath();
  checkPathsAndStacks();
  await loadByAbsolutePath();
  await importFromVMContext();
}

run().catch(error => {
  console.log("failed:", error);
  process.exitCode = 1;
});
