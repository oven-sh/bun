import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as counter from "./counter.mjs";
import legacy from "./legacy.cjs";
import data from "./data.json";

function requireLate() {
  return require("./late.cjs");
}

function resolvedPath(specifier) {
  const resolved = import.meta.resolve(specifier);
  return resolved.startsWith("file:") ? fileURLToPath(resolved) : resolved;
}

const counterPath = resolvedPath("./counter.mjs");
const legacyPath = resolvedPath("./legacy.cjs");
const latePath = resolvedPath("./late.cjs");
const dataPath = resolvedPath("./data.json");
const registryPath = resolvedPath("./registry.mjs");
const isCompiled = /\$bunfs|~BUN/.test(counterPath);

const folder = mkdtempSync(join(tmpdir(), "uncompiled-importer-"));
writeFileSync(
  join(folder, "importer.mjs"),
  `import { count } from ${JSON.stringify(counterPath)};
export const readCount = () => count;
export const importedNamespace = await import(${JSON.stringify(counterPath)});
`,
);
writeFileSync(
  join(folder, "plugin.mjs"),
  `import { register } from ${JSON.stringify(registryPath)};
register("plugin");
`,
);
writeFileSync(join(folder, "plain.cjs"), `module.exports = "plain file";\n`);
writeFileSync(
  join(folder, "requirer.cjs"),
  `const legacyPath = ${JSON.stringify(legacyPath)};
const dataPath = ${JSON.stringify(dataPath)};
const latePath = ${JSON.stringify(latePath)};
exports.legacy = require(legacyPath);
exports.requireData = () => require(dataPath);
exports.plain = require("./plain.cjs");
exports.requireLate = () => require(latePath);
`,
);

try {
  const importer = await import(join(folder, "importer.mjs"));
  const { default: requirer } = await import(join(folder, "requirer.cjs"));

  console.log("count before", importer.readCount());
  counter.increment();
  console.log("count after", importer.readCount());
  console.log("same namespace", importer.importedNamespace === counter);

  globalThis.pluginPath = join(folder, "plugin.mjs");
  const registry = await import("./registry.mjs");
  console.log("imported back while evaluating", registry.registered.join());

  const compiledLegacy = require("./legacy.cjs");
  console.log("imported legacy is required legacy", legacy === compiledLegacy);
  console.log("same legacy", requirer.legacy === compiledLegacy);
  console.log("legacy evaluations", globalThis.legacyEvaluations);
  console.log("own id", compiledLegacy.moduleId === legacyPath ? "path" : compiledLegacy.moduleId);
  console.log("module.require", compiledLegacy.moduleRequireType);

  const compiledData = require("./data.json");
  console.log("data name", data.name);
  console.log("same data", requirer.requireData() === compiledData);

  console.log("plain file", requirer.plain);

  console.log("not yet evaluated", globalThis.lateEvaluated === undefined);
  console.log("evaluated for the file outside", requirer.requireLate().fromLoader, globalThis.lateEvaluated, requirer.requireLate() === requireLate());

  const outcome = await new ShadowRealm().importValue(counterPath, "x").then(
    value => value,
    error => error.message.includes("SyntaxError"),
  );
  console.log("other realm", outcome === (isCompiled ? true : "x"));
} finally {
  rmSync(folder, { recursive: true, force: true });
}
