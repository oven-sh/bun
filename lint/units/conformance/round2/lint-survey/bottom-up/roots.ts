// usage: bun roots.ts <clone with the corpus> <observed/roots.tsv>
// The root files of every run instance as the default check hands them to the command, without a file written and
// without a process: name, class, case path, current directory, root files (separated by a blank).
// It prints the counts by extension, the instances with a JavaScript root (the only ones that the rules read) and
// those with a root that `bun --lint` has no loader for.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [scratch, outPath] = process.argv.slice(2);
if (scratch === undefined || outPath === undefined) {
  console.error("usage: bun roots.ts <clone with the corpus> <observed/roots.tsv>");
  process.exit(2);
}
const home = resolve(scratch, "test/cli/lint/conformance");
const { corpusPaths, suites } = await import(join(home, "runner/paths.ts"));
const { enumerateInstances } = await import(join(home, "runner/compiler_runner.ts"));
const { instanceInput } = await import(join(home, "runner/materialise.ts"));
const { parseTestFilesAndSymlinks } = await import(join(home, "runner/test_case_parser.ts"));
const { readFile } = await import(join(home, "runner/vfs.ts"));
const { getNormalizedAbsolutePath } = await import(join(home, "runner/tspath.ts"));
const { loadOracleTable, oracleOf, diffRootOf } = await import(join(home, "runner/oracle.ts"));

const paths = corpusPaths(join(home, "corpus"));
const table = loadOracleTable(paths);
void suites;
const lines: string[] = [];
const byExtension = new Map<string, { files: number; instances: Set<string> }>();
const javascript = /\.(js|jsx|mjs|cjs)$/;
// lint_command.rs loader_of: the extensions of DEFAULT_LOADERS that are JavaScript-like.
const loaded = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
let run = 0;
let withJavaScript = 0;
let onlyJavaScript = 0;
let withoutLoader = 0;
let onlyDeclarations = 0;
let refused = 0;
const kinds = { E: 0, C: 0 };
const javascriptKinds = { E: 0, C: 0 };
for (const instance of enumerateInstances(paths.cases)) {
  if (instance.status !== "run") continue;
  const diff = diffRootOf(table, instance.suite, instance.name);
  if (diff.fatal !== undefined) continue;
  run++;
  const kind: "E" | "C" = oracleOf(table, instance.suite, instance.name).class;
  kinds[kind]++;
  const filename = `${paths.cases}/${instance.file}`;
  const read = readFile(filename);
  if (!read.ok) throw new Error(`cannot read ${filename}`);
  const units = parseTestFilesAndSymlinks(read.contents, filename, (unitName: string, content: string) => ({
    value: { name: unitName, content },
    error: undefined,
  }));
  const made = units.ok ? instanceInput(units, instance.config, undefined, { libDirectory: paths.lib }) : units;
  if (!made.ok) {
    refused++;
    lines.push([instance.name, kind, instance.file, "", `REFUSED ${made.reason}`].join("\t"));
    continue;
  }
  const currentDirectory = getNormalizedAbsolutePath(made.input.currentDirectory, "/");
  const roots: string[] = made.input.rootFiles.map((name: string) => getNormalizedAbsolutePath(name, currentDirectory));
  lines.push([instance.name, kind, instance.file, currentDirectory, roots.join(" ")].join("\t"));
  for (const root of roots) {
    const base = root.slice(root.lastIndexOf("/") + 1);
    const declaration = /\.d\.(ts|mts|cts)$/.exec(base);
    const dot = base.lastIndexOf(".");
    const extension = declaration !== null ? declaration[0] : dot < 0 ? "(none)" : base.slice(dot);
    let entry = byExtension.get(extension);
    if (entry === undefined) byExtension.set(extension, (entry = { files: 0, instances: new Set() }));
    entry.files++;
    entry.instances.add(instance.name);
  }
  if (roots.some(root => javascript.test(root))) {
    withJavaScript++;
    javascriptKinds[kind]++;
  }
  if (roots.length > 0 && roots.every(root => javascript.test(root))) onlyJavaScript++;
  if (roots.some(root => !loaded.test(root))) withoutLoader++;
  if (roots.length > 0 && roots.every(root => /\.d\.(ts|mts|cts)$/.test(root))) onlyDeclarations++;
}
writeFileSync(resolve(outPath), lines.join("\n") + "\n");
console.log(`run instances ${run} (E ${kinds.E}, C ${kinds.C}); refused without a disk ${refused}`);
console.log(`with a JavaScript root ${withJavaScript} (E ${javascriptKinds.E}, C ${javascriptKinds.C}); every root JavaScript ${onlyJavaScript}`);
console.log(`with a root without a loader ${withoutLoader}; every root a declaration file ${onlyDeclarations}`);
console.log("root files by extension: files, instances");
for (const [extension, entry] of [...byExtension].sort((a, b) => b[1].files - a[1].files)) {
  console.log(`  ${extension.padEnd(8)} ${String(entry.files).padStart(6)} ${String(entry.instances.size).padStart(6)}`);
}
