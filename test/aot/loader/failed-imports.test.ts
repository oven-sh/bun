import { expect } from "bun:test";
import { test } from "../supported";
import { describeTree } from "./describe";

function installed(name: string, exports: object, files: string[] = ["index.js"]) {
  const directory = `node_modules/${name}`;
  const tree = { [`${directory}/package.json`]: JSON.stringify({ name, version: "1.0.0", exports }) };
  for (const file of files) tree[`${directory}/${file}`] = "";
  return tree;
}

const failures: [specifier: string, answer: string][] = [
  ["closed/hidden.js", "not found (PackagePathNotExported)"],
  ["closed/disabled", "not found (PackagePathNotExported)"],
  ["other-conditions", "not found (PackagePathNotExported)"],
  ["#unknown", "not found (PackageImportNotDefined)"],
  ["#/known", "not found (InvalidModuleSpecifier)"],
  ["leaves-its-folder", "not found (InvalidPackageTarget)"],
  ["mixed-keys", "not found (InvalidPackageConfiguration)"],
  ["names-a-folder/folder", "not found (UnsupportedDirectoryImport)"],
  ["names-no-file", "not found (PackageNotFound)"],
  ["names-no-file/lib", "not found (ModuleNotFound)"],
];

const files = {
  "package.json": JSON.stringify({ name: "app", version: "1.0.0", imports: { "#known": "./known.js" } }),
  "known.js": "",
  ...installed("closed", { ".": "./index.js", "./disabled": null }, ["index.js", "hidden.js", "disabled.js"]),
  ...installed("other-conditions", { ".": { browser: "./index.js" } }),
  ...installed("leaves-its-folder", { ".": "../closed/index.js" }),
  ...installed("mixed-keys", { ".": "./index.js", default: "./index.js" }),
  ...installed("names-a-folder", { "./folder": "./folder" }, ["folder/index.js"]),
  ...installed("names-no-file", { ".": "./missing.js", "./lib": "./missing.js" }, []),
};

test.each(["import", "require"] as const)("why %s finds no file", kind => {
  const write = (specifier: string) => (kind === "import" ? `import "${specifier}";` : `require("${specifier}");`);
  const main = kind === "import" ? "main.mjs" : "main.cjs";
  const text = ["#known", ...failures.map(([specifier]) => specifier)].map(write).join("\n");
  using graph = describeTree({ ...files, [main]: text }, [main]);
  const answers = graph.file(main).sites.map(site => [site.specifier, site.answer]);
  expect(answers).toEqual([["#known", "known.js"], ...failures]);
});
