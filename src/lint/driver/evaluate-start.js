// The first part of a script that runs a configuration file. The second part calls `finish` with the result.

// A PATH that came from the other side goes back as it came, one that is found here through `portablePath`: `resolve` is for comparing.
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");
const fs = require("node:fs");
// As it is given, with `/` on every system: what is answered has it as a key, by which it is looked up.
const path = process.argv.at(-1);
const marker = process.argv.at(-2);

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

function finish(config) {
  // A timer, a watcher or a server that the configuration has left behind would keep the process alive for ever. The answer is
  // there, whatever the configuration has made of `process.exitCode`.
  process.stdout.write(marker + JSON.stringify({ config }), () => process.exit(0));
}
