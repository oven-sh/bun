// The first part of a script that runs a configuration file. It keeps track of what the result
// depends on, so that it can be kept for the next run: the files that are loaded or looked at, and
// the environment variables that are read. The second part calls `finish` with the result.
const path = process.argv.at(-1);
const marker = process.argv.at(-2);
const { fileURLToPath, pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

// Who has removed the packages of oxlint, oxfmt and Vite+ still has `import { defineConfig } from "oxlint"` in the file.
for (const name of ["oxlint", "oxfmt", "vite-plus"]) {
  try {
    Bun.resolveSync(name, resolve(path, ".."));
  } catch {
    const exports = { defineConfig: config => config };
    Bun.plugin({
      name: `${name}, which is not installed`,
      setup: build => void build.module(name, () => ({ exports, loader: "object" })),
    });
  }
}

// ───────────── what the file depends on ─────────────

const touched = new Set();
const environment = new Set();
// It depends on something that cannot be checked again cheaply.
let uncacheable = false;

function wrap(object, names, before) {
  for (const name of names) {
    const original = object?.[name];
    if (typeof original !== "function") continue;
    const wrapper = function (...args) {
      before(...args);
      return Reflect.apply(original, this, args);
    };
    try {
      object[name] = Object.assign(wrapper, original);
    } catch {
      uncacheable = true;
    }
  }
}
const touch = file => {
  try {
    if (file instanceof URL) touched.add(fileURLToPath(file));
    else if (typeof file === "string" || Buffer.isBuffer(file)) touched.add(resolve(String(file)));
  } catch {}
};
const giveUp = () => {
  uncacheable = true;
};
const reads = ["readFile", "readdir", "stat", "lstat", "access", "realpath", "open", "opendir", "exists"];
const fs = require("node:fs");
wrap(fs, [...reads, ...reads.map(name => `${name}Sync`), "createReadStream"], touch);
wrap(fs.promises, reads, touch);
wrap(fs, ["glob", "globSync", "watch", "watchFile"], giveUp);
wrap(fs.promises, ["glob", "watch"], giveUp);
wrap(
  require("node:child_process"),
  ["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork"],
  giveUp,
);
wrap(globalThis, ["fetch"], giveUp);
wrap(globalThis.Bun, ["spawn", "spawnSync", "$", "Glob", "connect"], giveUp);
wrap(globalThis.Bun, ["file"], touch);
// Only the names leave this process: the values can be secrets.
const note = key => {
  if (typeof key === "string") environment.add(key);
};
// Packages list the environment to look for their own variables (`debug`: `DEBUG_*`).
const isCalledByPackage = () => {
  const caller = new Error().stack.split("\n").find(line => /[\\/]/.test(line) && !line.includes("[eval]"));
  return caller !== undefined && /[\\/]node_modules[\\/]/.test(caller);
};
process.env = new Proxy(process.env, {
  get: (target, key) => (note(key), target[key]),
  has: (target, key) => (note(key), key in target),
  set: (target, key, value) => ((target[key] = value), true),
  ownKeys: target => (isCalledByPackage() || giveUp(), Reflect.ownKeys(target)),
});

// `dependencies`: what the result depends on besides what has been loaded or looked at.
function finish(config, dependencies = [path]) {
  // A package is as good as its `package.json`, which is written when it is installed.
  const files = new Set();
  for (const file of [...dependencies, ...Object.keys(require.cache), ...touched]) {
    const match = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(file);
    files.add(match ? resolve(match[1], "package.json") : file);
  }
  process.stdout.write(
    marker + JSON.stringify({ config, files: [...files], environment: [...environment], uncacheable }),
  );
}
