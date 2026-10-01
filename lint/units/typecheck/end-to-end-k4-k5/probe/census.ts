// Research probe: what the run instances of the reference suite need from a program layer that takes resolved inputs.
// usage: bun /tmp/e2e/census.ts      reads /workspace/ref/typescript-go, prints counts, writes /tmp/e2e/census.tsv
import { writeFileSync } from "node:fs";
import {
  enumerateCase,
  factsOf,
  inputOf,
  listCases,
  loadCorpus,
  referenceLayout,
} from "/workspace/notes/lint/units/conformance/test-file-and-sweep/top-down/index.ts";

const layout = referenceLayout();
const corpus = loadCorpus(layout);
const cases = listCases(layout.casesRoot);
const rows: string[] = [];
const count = new Map<string, number>();
const bump = (k: string, n = 1) => count.set(k, (count.get(k) ?? 0) + n);
const optionUse = new Map<string, number>();

const resolverOptions = ["paths", "baseurl", "rootdirs", "typeroots", "types", "moduleresolution", "modulesuffixes", "customconditions", "libreplacement", "importhelpers", "jsximportsource", "resolvepackagejsonexports", "resolvepackagejsonimports", "preservesymlinks", "traceresolution", "allowimportingtsextensions", "rewriterelativeimportextensions", "resolvejsonmodule", "allowarbitraryextensions", "maxnodemodulejsdepth", "noresolve"];
const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])([^"'\n]*)\1/g;
const tripleSlash = /^\s*\/\/\/\s*<reference\s+(path|types|lib|no-default-lib)\s*=/gm;
const ambientModule = /\bdeclare\s+module\s+["']/;

for (const casePath of cases) {
  for (const inst of enumerateCase(layout.casesRoot, casePath)) {
    bump("instances");
    if (inst.status !== "run") {
      bump("status:" + inst.status);
      continue;
    }
    bump("run");
    const kind = factsOf(corpus, inst).kind ?? "?";
    const r = inputOf(inst, { layout });
    if (!r.ok) {
      bump("input-not-ok:" + r.status);
      continue;
    }
    const i = r.input;
    const files = [...i.roots, ...i.otherFiles];
    const names = files.map(f => f.name);
    const opt = new Set(Object.keys(i.compilerOptions).map(k => k.toLowerCase()));
    for (const k of opt) optionUse.set(k, (optionUse.get(k) ?? 0) + 1);
    const flags: string[] = [];
    const has = (k: string) => opt.has(k);
    const val = (k: string) => String(i.compilerOptions[k] ?? i.configuration[k] ?? "").toLowerCase();
    if (i.configFile !== undefined) flags.push("tsconfig");
    if (i.links.length > 0) flags.push("links");
    if (i.includeLibDirectory) flags.push("testlib");
    if (names.some(n => n.includes("/node_modules/"))) flags.push("node_modules");
    if (names.some(n => n.endsWith("/package.json"))) flags.push("package.json");
    if (names.some(n => /\.json$/.test(n) && !n.endsWith("/package.json"))) flags.push("json-unit");
    if (names.some(n => /\.(js|jsx|mjs|cjs)$/.test(n))) flags.push("js-unit");
    if (names.some(n => /\.(tsx|jsx)$/.test(n))) flags.push("jsx-unit");
    if (names.some(n => /\.(mts|cts|mjs|cjs)$/.test(n))) flags.push("mts-cts");
    if (i.otherFiles.length > 0) flags.push("other-files");
    if (resolverOptions.some(has)) flags.push("resolver-option");
    if (val("declaration") === "true" || val("composite") === "true") flags.push("declaration");
    if (val("isolateddeclarations") === "true") flags.push("isolatedDeclarations");
    if (val("nolib") === "true") flags.push("noLib");
    if (has("lib")) flags.push("lib-option");
    if (has("target")) flags.push("target-option");
    if (/^(react-jsx|react-jsxdev)$/.test(val("jsx"))) flags.push("jsx-runtime");
    if (/node16|node18|node20|nodenext/.test(val("module"))) flags.push("node-module");
    if (i.captureSuggestions) flags.push("suggestions");
    if (val("noemit") === "true") flags.push("noEmit");
    if (val("incremental") === "true") flags.push("incremental");
    let relative = 0;
    let bare = 0;
    let refPath = 0;
    let refTypes = 0;
    let refLib = 0;
    let ambient = false;
    for (const f of files) {
      for (const m of f.content.matchAll(specifier)) {
        if (m[2].startsWith("./") || m[2].startsWith("../") || m[2] === "." || m[2] === "..") relative++;
        else bare++;
      }
      for (const m of f.content.matchAll(tripleSlash)) {
        if (m[1] === "path") refPath++;
        else if (m[1] === "types") refTypes++;
        else if (m[1] === "lib") refLib++;
        else flags.push("no-default-lib");
      }
      if (ambientModule.test(f.content)) ambient = true;
    }
    if (relative > 0) flags.push("relative-specifier");
    if (bare > 0) flags.push("bare-specifier");
    if (refPath > 0) flags.push("reference-path");
    if (refTypes > 0) flags.push("reference-types");
    if (refLib > 0) flags.push("reference-lib");
    if (ambient) flags.push("ambient-module");
    const hard = ["tsconfig", "links", "testlib", "node_modules", "package.json", "resolver-option", "jsx-runtime", "node-module", "reference-types", "incremental", "json-unit"];
    const needsResolution = ["relative-specifier", "bare-specifier", "reference-path"];
    let level: string;
    if (flags.some(f => hard.includes(f))) level = "2-resolver";
    else if (flags.includes("bare-specifier")) level = "1b-bare-unresolved-or-ambient";
    else if (flags.some(f => needsResolution.includes(f)) || flags.includes("other-files")) level = "1-relative";
    else level = "0-no-resolution";
    const js = flags.includes("js-unit") ? "js" : "ts";
    const decl = flags.includes("declaration") || flags.includes("isolatedDeclarations") ? "decl" : "nodecl";
    bump(`level ${level}`);
    bump(`level ${level} ${kind}`);
    bump(`level ${level} ${js} ${decl} ${kind}`);
    for (const f of new Set(flags)) bump("flag:" + f);
    rows.push([inst.suite, inst.name, kind, level, js, decl, files.length, [...new Set(flags)].join(",")].join("\t"));
  }
}
writeFileSync("/tmp/e2e/census.tsv", rows.join("\n") + "\n");
for (const [k, v] of [...count].sort((a, b) => (a[0] < b[0] ? -1 : 1))) console.log(String(v).padStart(6), k);
console.log("--- options by use");
console.log([...optionUse].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
