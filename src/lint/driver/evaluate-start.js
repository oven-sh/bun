// The first part of a script that runs a configuration file, after `given`. The second part calls `finish` with the result.

// A PATH that came from the other side goes back as it came, one that is found here through `portablePath`: `resolve` is for comparing.
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");
const fs = require("node:fs");
// A configuration asks which modules are built in, to tell them from packages. It means Node.js, where `undici` and `ws` are
// packages. The same is in `worker/main.js`.
{
  const nodeModule = require("node:module");
  const isOfBun = name => /^bun(?::|$)/.test(name) || name === "undici" || name === "ws";
  const { isBuiltin } = nodeModule;
  nodeModule.builtinModules = nodeModule.builtinModules.filter(name => !isOfBun(name));
  nodeModule.isBuiltin = name => !isOfBun(name) && isBuiltin(name);
}
// `path`: as it is given, with `/` on every system: what is answered has it as a key, by which it is looked up. `argument`: what
// some scripts take.
const { path, marker, argument } = given;
// A configuration sees the command line of the command, as in ESLint, Prettier and oxlint, which run it in their own process, and
// as a plugin does here.
for (const it of given.commandLine) process.argv.push(it);

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

function finish(config, stringify = JSON.stringify) {
  // Exits explicitly, because a timer, watcher or server that the config left behind would keep the process alive forever.
  // The result has been written by then, so the exit code is 0 whatever the config did to `process.exitCode`.
  // `--doctor` reports which packages the config needs in order to load.
  const isDoctor = given.commandLine.includes("--doctor");
  // Skip cache entries that aren't files. A script can put those there to stand in for a module.
  const modules = isDoctor ? Object.keys(require.cache).filter(file => fs.existsSync(file)) : undefined;
  process.stdout.write(marker + stringify({ config, modules }), () => process.exit(0));
}
