// Generates `presets.txt`: the configs that ESLint (`@eslint/js`) and typescript-eslint publish, as JSON.
//
//   ESLINT_DIR=<checkout of eslint with node_modules> \
//   TYPESCRIPT_ESLINT_DIR=<built checkout of typescript-eslint> node generate-presets.mjs

import { readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const requireFromEslint = createRequire(join(resolve(process.env.ESLINT_DIR), "package.json"));
const pluginDir = join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin");
const requireFromPlugin = createRequire(join(pluginDir, "package.json"));

const js = requireFromEslint("./packages/js");
const presets = {
  "eslint/recommended": [{ rules: js.configs.recommended.rules }],
  "eslint/all": [{ rules: js.configs.all.rules }],
};

const plugin = Symbol("plugin"),
  parser = Symbol("parser");
const serialize = ({ name, ...config }) => {
  if (config.plugins) config.plugins = { "@typescript-eslint": "@typescript-eslint/eslint-plugin" };
  if (config.languageOptions?.parser === parser)
    config.languageOptions = { ...config.languageOptions, parser: "typescript-eslint/parser" };
  return config;
};
// Objects that several configurations start with are written once, and referred to by name.
const shared = new Map();
for (const file of readdirSync(join(pluginDir, "dist/configs/flat"))
  .filter(file => file.endsWith(".js"))
  .sort()) {
  const name = file.slice(0, -3);
  const objects = [requireFromPlugin(`./dist/configs/flat/${file}`).default(plugin, parser)].flat().map(serialize);
  if (name === "base" || name === "eslint-recommended") shared.set(JSON.stringify(objects[0]), `typescript/${name}`);
  presets[`typescript/${name}`] = objects;
}
for (const [name, objects] of Object.entries(presets)) {
  presets[name] = objects.map(object => {
    const reference = shared.get(JSON.stringify(object));
    return reference && reference !== name ? reference : object;
  });
}

const severities = { off: 0, warn: 1, error: 2 };
for (const object of Object.values(presets).flat()) {
  if (typeof object === "string" || !object.rules) continue;
  object.rules = Object.fromEntries(
    Object.entries(object.rules).map(([id, value]) => [
      id,
      Array.isArray(value) ? [severities[value[0]], ...value.slice(1)] : severities[value],
    ]),
  );
}

// One `name<tab>JSON` line per config.
const text = Object.entries(presets)
  .map(([name, objects]) => `${name}\t${JSON.stringify(objects)}\n`)
  .join("");
writeFileSync(join(import.meta.dirname, "presets.txt"), text);
console.log(
  `${Object.keys(presets).length} configs, ${text.length} bytes, from @eslint/js ${requireFromEslint("./packages/js/package.json").version} and @typescript-eslint/eslint-plugin ${requireFromPlugin("./package.json").version}`,
);
