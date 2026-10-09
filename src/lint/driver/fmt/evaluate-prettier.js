// Prints the configuration of Prettier in a file that is not JSON: a program, YAML, TOML, JSON5, or
// the name of a package that has the configuration.

const { basename, dirname, extname } = require("node:path");

const importDefault = async file => (await import(pathToFileURL(file).href)).default;
const read = file => fs.readFileSync(file, "utf8").replace(/^﻿/, "");
const loaders = {
  ".toml": file => Bun.TOML.parse(read(file)),
  ".json5": file => (Bun.JSON5 ? Bun.JSON5.parse(read(file)) : importDefault(file)),
  ".json": file => JSON.parse(read(file)),
  ".yaml": file => Bun.YAML.parse(read(file)),
  ".yml": file => Bun.YAML.parse(read(file)),
  "": file => Bun.YAML.parse(read(file)),
};

// `import { defineConfig } from "oxfmt"` goes on working in a project that has removed the package.
if (basename(path).startsWith("oxfmt.")) {
  let isInstalled = true;
  try {
    Bun.resolveSync("oxfmt", dirname(path));
  } catch {
    isInstalled = false;
  }
  if (!isInstalled) {
    Bun.plugin({
      name: "oxfmt",
      setup(build) {
        build.module("oxfmt", () => ({ exports: { defineConfig: config => config }, loader: "object" }));
      },
    });
  }
}

let config;
if (basename(path) === "package.json") config = (await importDefault(path)).prettier;
else if (basename(path) === "package.yaml") config = Bun.YAML.parse(read(path))?.prettier;
else config = await (loaders[extname(path)] ?? importDefault)(path);
if (basename(path).startsWith("oxfmt.")) {
  if (config === undefined) throw new Error("Configuration file has no default export.");
  if (config === null || typeof config !== "object")
    throw new Error("Configuration file must have a default export that is an object.");
}
// `"prettier": "my-prettier-config-package-or-file"`
if (typeof config === "string") config = await importDefault(Bun.resolveSync(config, dirname(path)));
if (config !== undefined && config !== null && typeof config !== "object") {
  throw new TypeError(`Config is only allowed to be an object, but received ${typeof config} in "${path}"`);
}
// What is not JSON, like a plugin that is an object, is left out.
finish(JSON.parse(JSON.stringify(config ?? null, (key, value) => (typeof value === "bigint" ? undefined : value))));
