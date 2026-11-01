// The ways in which programs load every file of a folder beside them: the folder is held in a variable, listed, and each name is joined to it.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const commands = path.join(import.meta.dirname, "commands");
for (const file of readdirSync(commands)
  .filter(file => file.endsWith(".js"))
  .sort()) {
  const command = require(path.join(commands, file));
  console.log("required:", command.name, command.run());
}

const plugins = path.resolve(import.meta.dirname, "plugins");
for (const file of (await readdir(plugins)).sort()) {
  const { default: plugin } = await import(pathToFileURL(path.join(plugins, file)).href);
  console.log("imported by a URL of a path:", plugin.name, plugin.run());
}

const folder = new URL("./plugins/", import.meta.url);
for (const file of readdirSync(folder).sort()) {
  const { default: plugin } = await import(new URL(file, folder));
  console.log("imported by a URL against a URL:", plugin.name, plugin.run());
}

for (const file of readdirSync(plugins).sort()) {
  const { default: plugin } = await import(plugins + "/" + file);
  console.log("imported by a sum:", plugin.name, plugin.run());
}

const models = require("./models");
for (const name of Object.keys(models).sort()) console.log("an index file:", name, models[name].run());
