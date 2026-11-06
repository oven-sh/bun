// Small TypeScript projects of four to ten files in two to five folders. Some folders have a tsconfig.json, and its compiler options may be others than the project's.
//
//   constants        a file exports what it says of itself (`import.meta.main`, `require.main === module`, `import.meta.file`), literals, and what it makes of the constants of other files
//   read by          functions of any file, the entry point's among them: as a value, in a branch, and in front of an `import()` that runs in one arm alone
//   packages         name one file for `import` and another for `require`; the entry point requires each, other files import them
//   a `require`      that one file exports gets whole paths that start at the folder of the caller, with a computed part or without, and relative ones
//
// The files with constants import one another without a cycle and nothing else, so no constant is read before it is set. The entry point calls every function at its end.
import { posix } from "node:path";
import type { Random } from "./random";

const configurations = [
  {},
  { compilerOptions: { strict: true } },
  { compilerOptions: { strict: false, lib: ["ES2021"] } },
  { compilerOptions: { strictNullChecks: true } },
  { compilerOptions: { strict: true, exactOptionalPropertyTypes: true } },
  { compilerOptions: { allowJs: false, resolveJsonModule: false } },
];

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const folders = ["", ...Array.from({ length: random.between(1, 3) }, (_, index) => `f${index + 1}/`)];
  if (random.chance(0.4)) folders.push(folders.at(-1) + "inner/");
  if (random.chance(0.5)) files["tsconfig.json"] = JSON.stringify(random.pick(configurations));
  for (const folder of folders) {
    if (folder && random.chance(0.75)) files[folder + "tsconfig.json"] = JSON.stringify(random.pick(configurations));
    files[folder + "value.cjs"] = `module.exports = "the value in ${folder || "the first folder"}";\n`;
  }
  const packages = Array.from({ length: random.below(3) }, (_, index) => `package-${index}`);
  for (const name of packages) {
    const manifest = { name, main: "./required.js", module: "./imported.js", types: "./index.d.ts" };
    files[`node_modules/${name}/package.json`] = JSON.stringify(manifest);
    files[`node_modules/${name}/required.js`] = `exports.kind = "the file of ${name} for require";\n`;
    files[`node_modules/${name}/imported.js`] = `export const kind = "the file of ${name} for import";\n`;
    files[`node_modules/${name}/index.d.ts`] = "export declare const kind: string;\n";
  }

  type File = {
    path: string;
    imports: Map<number, Set<string>>;
    lines: string[];
    constants: string[];
    functions: string[];
  };
  const create = (path: string): File => ({ path, imports: new Map(), lines: [], constants: [], functions: [] });
  // The entry point, then the files with functions, then the files with constants.
  const functionFiles = random.between(1, 4);
  const constantFiles = random.between(1, 4);
  const all = [create("main.ts")];
  for (let index = 1; index <= functionFiles + constantFiles; index++)
    all.push(create(`${random.pick(folders)}m${index}.ts`));
  const firstConstantFile = 1 + functionFiles;
  const specifier = (from: File, to: string) => {
    const relative = posix.relative(posix.dirname(from.path), to);
    return relative.startsWith(".") ? relative : "./" + relative;
  };
  const take = (into: number, from: number, name: string) => {
    if (into !== from) {
      if (!all[into].imports.has(from)) all[into].imports.set(from, new Set());
      all[into].imports.get(from)!.add(name);
    }
    return name;
  };

  const ownFacts = [
    "import.meta.main",
    "!import.meta.main",
    "require.main === module",
    "import.meta.file",
    `"x"`,
    `""`,
    "0",
    "7",
  ];
  for (let index = all.length - 1; index >= 0; index--) {
    const laterConstants = all.flatMap((file, from) =>
      from > index && from >= firstConstantFile ? file.constants.map(name => [from, name] as const) : [],
    );
    const readsOthers = (index === 0 || index >= firstConstantFile) && laterConstants.length > 0;
    for (let count = random.between(1, 4); count > 0; count--) {
      const name = `C${index}_${count}`;
      const form = readsOthers ? random.pick(["own", "own", "same", "chosen"]) : "own";
      const [from, other] = readsOthers ? random.pick(laterConstants) : [index, ""];
      const value =
        form === "own"
          ? random.pick(ownFacts)
          : form === "same"
            ? take(index, from, other)
            : `${take(index, from, other)} ? "yes ${count}" : "no ${count}"`;
      all[index].lines.push(`export const ${name} = ${value};`);
      all[index].constants.push(name);
    }
  }

  const constants = all.flatMap((file, from) => file.constants.map(name => [from, name] as const));
  const exporter = random.chance(0.7) ? random.between(1, functionFiles) : 0;
  let loaded = 0;
  for (let index = 0; index < firstConstantFile; index++) {
    const file = all[index];
    const folder = posix.dirname(file.path) === "." ? "" : posix.dirname(file.path) + "/";
    for (let count = random.between(1, 4); count > 0; count--) {
      const name = `f${index}_${count}`;
      const constant = () => take(index, ...random.pick(constants));
      const forms = ["branch", "branch", "value", "import"];
      if (packages.length) forms.push("package");
      if (exporter && exporter !== index) forms.push("whole path", "whole path", "computed part", "relative");
      const form = random.pick(forms);
      let value: string;
      if (form === "branch") value = `() => (${constant()} ? "true" : "false")`;
      else if (form === "value") value = `() => String(${constant()})`;
      else if (form === "import") {
        const path = `${folder}loaded-${++loaded}.ts`;
        files[path] = `export const text: string = "loaded ${loaded}";\n`;
        value = `async () => (${constant()} ? "nothing" : (await import("${specifier(file, path)}")).text)`;
      } else if (form === "package") {
        const from = random.pick(packages);
        file.lines.unshift(`import { kind as kind${count} } from "${from}";`);
        value = `() => kind${count}`;
      } else {
        const argument =
          form === "relative"
            ? `"./value.cjs"`
            : form === "computed part"
              ? `import.meta.dirname + "/" + (process.argv.length < 99 ? "value" : "other") + ".cjs"`
              : random.pick([
                  `import.meta.dirname + "/value.cjs"`,
                  "`${import.meta.dir}/value.cjs`",
                  `__dirname + "/value.cjs"`,
                ]);
        value = `() => ${take(index, exporter, "exportedRequire")}(${argument})`;
      }
      file.lines.push(`export const ${name} = ${value};`);
      file.functions.push(name);
    }
  }
  if (exporter) {
    all[exporter].lines.unshift(`import { createRequire } from "node:module";`);
    all[exporter].lines.push("export const exportedRequire = createRequire(import.meta.url);");
  }

  const main = all[0];
  for (const name of packages) main.lines.push(`console.log((require("${name}") as { kind: string }).kind);`);
  for (const name of main.constants) main.lines.push(`console.log("${name}", ${name});`);
  all.forEach((file, from) => {
    for (const name of file.functions) main.lines.push(`console.log("${name}", await ${take(0, from, name)}());`);
  });
  for (const file of all) {
    const imports = [...file.imports].sort(([a], [b]) => a - b);
    const head = imports.map(
      ([from, names]) => `import { ${[...names].sort().join(", ")} } from "${specifier(file, all[from].path)}";`,
    );
    files[file.path] = [...head, ...file.lines].join("\n") + "\n";
  }
  const { "main.ts": text, ...others } = files;
  return { file: "main.ts", text, files: others };
}
