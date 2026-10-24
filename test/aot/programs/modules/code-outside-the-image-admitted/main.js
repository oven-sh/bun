// Built with --compile-inspector, a computed require() or import() loads code that is not in the executable as plain Bun does: a debugger can run any code, so such a build counts on nothing about the code that runs. modules/code-outside-the-image-is-refused is the same program built without the option.
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const inside = require("./inside.cjs");

const folder = mkdtempSync(join(tmpdir(), "outside-"));
function written(name, text) {
  const path = join(folder, name);
  writeFileSync(path, text);
  return path;
}
function refusal(error, specifier) {
  const message = String(error.message);
  return "refused; the message names the specifier: " + message.includes(specifier) + ", another entry point: " + message.includes("another entry point") + ", --external: " + message.includes("--external");
}
function required(label, specifier, show) {
  try { console.log(label + ": " + show(require(specifier))); } catch (error) { console.log(label + ": " + refusal(error, specifier)); }
}
async function imported(label, specifier, show, options) {
  try { console.log(label + ": " + show(await import(specifier, options))); } catch (error) { console.log(label + ": " + refusal(error, specifier)); }
}

async function main() {
  const names = ["inside"];
  required("require of a module of the executable, by a computed name", "./" + names[0] + ".cjs", module => module.where + " " + (module === inside));
  await imported("import of it", "./" + names[0] + ".cjs", module => module.default.where);
  required("require of CommonJS written at run time", written("outside.cjs", 'module.exports = { where: "outside" };\n'), module => module.where);
  await imported("import of an ES module written at run time", written("outside.mjs", 'export const where = "outside";\n'), module => module.where);
  required("require of TypeScript written at run time", written("outside.ts", 'export const where: string = "outside";\n'), module => module.where);
  required("require of JSON written at run time", written("data.json", '{ "where": "outside" }\n'), module => module.where);
  await imported("import of JSON written at run time", written("more.json", '{ "where": "outside" }\n'), module => module.default.where, { with: { type: "json" } });
  required("require of TOML written at run time", written("data.toml", 'where = "outside"\n'), module => module.where);
  required("the module of the executable once more", "./" + names[0] + ".cjs", module => module.where + " " + (module === inside));
}
main().finally(() => rmSync(folder, { recursive: true, force: true }));
