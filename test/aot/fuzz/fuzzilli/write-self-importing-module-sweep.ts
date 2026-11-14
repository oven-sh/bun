// Generates programs where a module imports or requires itself, its evaluation fails, and the entry loads it two or three times.
// Each program combines one entry from each table: the self-import, the failure, the sequence of loads, the value that the module retains in a global array,
// a leaf module that it also imports, sequential or concurrent loads, and an uncalled function in the entry. CommonJS and ES modules have their own tables.
// The program number selects the entries, so a number always produces the same program. Each program is compiled on its own.
//
//   bun write-self-importing-module-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<format>--<self-import>--<failure>--<loads>--<retained>--<leaf>--<schedule>--<entry>.cjs
//   bun write-self-importing-module-sweep.ts count
//   bun write-self-importing-module-sweep.ts named <pattern> <folder> [limit]
//
// A failed load is not cached, so the next load evaluates the module again with a new module object. On exit, each program prints the result of each load,
// the children of the entry's module object, and each retained value. For a retained module object it prints the children and each child's index among the retained values.
import { mkdirSync, writeFileSync } from "fs";

type ModuleFormat = {
  name: string;
  fileName: string;
  leafFileName: string;
  leafSource: string;
  prologue: string;
  epilogue: string;
  selfImports: [string, string][];
  failures: [string, string][];
  retainedValues: [string, string][];
  leafImport: string;
};

// Two pending loads can settle in either order. The entry stores each load's result at the load's index and sorts the results of the self-imports.
const emitSettlementHandlers = (callPrefix: string, label: string) =>
  `.then(() => ${callPrefix}"${label} loaded"), error => ${callPrefix}"${label} rejected " + error.name));`;

const moduleFormats: ModuleFormat[] = [
  {
    name: "commonjs",
    fileName: "target.cjs",
    leafFileName: "leaf.cjs",
    leafSource: "exports.leaf = true;",
    prologue: 'exports.early = 1;\nlogEvent("target evaluates");',
    epilogue: "exports.late = 2;",
    selfImports: [
      ["self-require", 'require("./target.cjs");'],
      ["self-dynamic-import", 'import("./target.cjs")' + emitSettlementHandlers("logSelfImport(", "self-import")],
      ["self-create-require", 'require("node:module").createRequire(__filename)("./target.cjs");'],
    ],
    failures: [
      ["throw", 'throw new Error("no");'],
      ["throwing-call", 'JSON.parse("{");'],
      ["missing-module", 'require("./missing.cjs");'],
      ["exit-in-finally", 'try {\n  throw new Error("no");\n} finally {\n  process.exit(0);\n}'],
      ["no-failure", ""],
    ],
    retainedValues: [
      ["retains-module", "(globalThis.retained ??= []).push(module);"],
      ["retains-require", "(globalThis.retained ??= []).push(require);"],
      ["retains-exports", "(globalThis.retained ??= []).push(exports);"],
      ["retains-nothing", ""],
    ],
    leafImport: 'require("./leaf.cjs");',
  },
  {
    name: "esm",
    fileName: "target.mjs",
    leafFileName: "leaf.mjs",
    leafSource: "export const leaf = true;",
    prologue: 'import { createRequire } from "node:module";\nexport const early = 1;\nlogEvent("target evaluates");',
    epilogue: "export const late = 2;",
    selfImports: [
      ["self-static-import", 'import "./target.mjs";'],
      ["self-dynamic-import", 'import("./target.mjs")' + emitSettlementHandlers("logSelfImport(", "self-import")],
      [
        "self-create-require",
        'try {\n  createRequire(import.meta.url)("./target.mjs");\n} catch (error) {\n  logSelfImport("self-require threw " + error.name);\n}',
      ],
    ],
    failures: [
      ["throw", 'throw new Error("no");'],
      ["throwing-call", 'JSON.parse("{");'],
      ["missing-module", 'await import("./missing.mjs");'],
      ["rejected-await", 'await Promise.reject(new Error("no"));'],
      ["exit-in-finally", 'try {\n  throw new Error("no");\n} finally {\n  process.exit(0);\n}'],
      ["no-failure", ""],
    ],
    retainedValues: [
      ["retains-created-require", "(globalThis.retained ??= []).push(createRequire(import.meta.url));"],
      ["retains-import-meta-require", "(globalThis.retained ??= []).push(import.meta.require);"],
      ["retains-nothing", ""],
    ],
    leafImport: 'import "./leaf.mjs";',
  },
];

// R: require() in a try block. I: import(). S: a static import in a separate module that the entry imports.
const loadSequences = ["RI", "IR", "RR", "II", "RS", "SR", "SI", "IS", "SS", "RRR", "III", "RIR", "IRI"];
const loadNames: Record<string, string> = { R: "require", I: "import", S: "static-import" };

const leafPositions = ["no-leaf", "leaf-before-self", "leaf-after-self"];
const schedules = ["sequential-loads", "concurrent-loads"];
const entries = ["plain-entry", "entry-with-uncalled-function"];

const countPrograms = (format: ModuleFormat) =>
  format.selfImports.length *
  format.failures.length *
  loadSequences.length *
  format.retainedValues.length *
  leafPositions.length *
  schedules.length *
  entries.length;
const total = moduleFormats.reduce((sum, format) => sum + countPrograms(format), 0);

const indent = (source: string, prefix = "  ") => prefix + source.replaceAll("\n", "\n" + prefix);
const joinLines = (...parts: string[]) => parts.filter(Boolean).join("\n");

const entryPrologue = `const path = require("node:path");
const events = [];
const loadResults = [];
const selfImportResults = [];
globalThis.logEvent = event => events.push(event);
globalThis.logSelfImport = result => selfImportResults.push(result);
const recordLoad = (index, result) => (loadResults[index] = result);
const getBaseName = value => path.basename(String(value?.id ?? value?.filename ?? value));
function describeValue(value, retained) {
  if (typeof value === "function") return "function " + typeof value.resolve;
  if (value && "children" in value) return "module " + getBaseName(value) + " " + value.loaded + " [" + value.children.map(child => getBaseName(child) + "#" + retained.indexOf(child)).join("+") + "] " + Object.keys(value.exports ?? {}).join("+");
  return "object " + Object.keys(value).join("+");
}
process.on("exit", () => {
  const retained = globalThis.retained ?? [];
  console.log("events: " + events.join(" . "));
  console.log("loads: " + Array.from(loadResults, result => result ?? "pending").join(" . "));
  console.log("self-imports: " + selfImportResults.sort().join(" . "));
  console.log("entry children: " + module.children.map(child => getBaseName(child) + "#" + retained.indexOf(child)).join("+"));
  retained.forEach((value, index) => console.log("retained " + index + ": " + describeValue(value, retained)));
});`;

function write(index: number): { name: string; text: string } {
  let format = moduleFormats[0];
  if (index >= countPrograms(format)) {
    index -= countPrograms(format);
    format = moduleFormats[1];
  }
  const pick = <T>(table: readonly T[]): T => {
    const entry = table[index % table.length];
    index = Math.floor(index / table.length);
    return entry;
  };
  const loadSequence = pick(loadSequences);
  const [failureName, failure] = pick(format.failures);
  const [selfImportName, selfImport] = pick(format.selfImports);
  const [retainedName, retain] = pick(format.retainedValues);
  const leafPosition = pick(leafPositions);
  const schedule = pick(schedules);
  const entry = pick(entries);
  const awaitPrefix = schedule === "sequential-loads" ? "await " : "";
  const staticImporters: string[] = [];
  const loads = [...loadSequence].map((letter, loadIndex) => {
    if (letter === "R")
      return `try {\n  recordLoad(${loadIndex}, "required " + Object.keys(require("./${format.fileName}")).join("+"));\n} catch (error) {\n  recordLoad(${loadIndex}, "require threw " + error.name);\n}`;
    if (letter === "I")
      return `${awaitPrefix}import("./${format.fileName}").then(namespace => recordLoad(${loadIndex}, "imported " + Object.keys(namespace).join("+")), error => recordLoad(${loadIndex}, "import rejected " + error.name));`;
    staticImporters.push(
      `// @filename: ./static-importer-${staticImporters.length + 1}.mjs\nimport "./${format.fileName}";`,
    );
    return `${awaitPrefix}import("./static-importer-${staticImporters.length}.mjs")${emitSettlementHandlers(`recordLoad(${loadIndex}, `, "static import")}`;
  });
  const entryBody = joinLines(...loads, 'logEvent("entry finished");');
  const entrySource = joinLines(
    entryPrologue,
    awaitPrefix ? joinLines("(async () => {", indent(entryBody), "})();") : entryBody,
    entry === "plain-entry"
      ? ""
      : 'function uncalled() {\n  var prototype = Function.prototype;\n  return "missing" in Bun;\n}',
  );
  const targetSource = joinLines(
    format.prologue,
    leafPosition === "leaf-before-self" ? format.leafImport : "",
    selfImport,
    leafPosition === "leaf-after-self" ? format.leafImport : "",
    retain,
    failure,
    format.epilogue,
  );
  return {
    name: `${format.name}--${selfImportName}--${failureName}--${[...loadSequence].map(letter => loadNames[letter]).join("-then-")}--${retainedName}--${leafPosition}--${schedule}--${entry}.cjs`,
    text:
      joinLines(
        entrySource,
        `// @filename: ./${format.fileName}`,
        targetSource,
        leafPosition === "no-leaf" ? "" : `// @filename: ./${format.leafFileName}\n${format.leafSource}`,
        ...staticImporters,
      ) + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(5, "0");
if (process.argv[2] === "count") console.log(total);
else if (process.argv[2] === "named") {
  const [pattern, folder, limit] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let index = 0; index < total && written < limit; index++) {
    const program = write(index);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
