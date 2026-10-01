// Writes the enumeration as a table: the replacement of the lost instances.tsv (research artefact).
import { enumerateInstances } from "./compiler_runner";
import { annotate, readFileNameSet } from "./annotate";
const tsgo = "/workspace/ref/typescript-go/testdata";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot: root });
annotate(e.instances, {
  tsgoBaselines: tsgo + "/baselines/reference/submodule",
  accepted: readFileNameSet(tsgo + "/submoduleAccepted.txt"),
  triaged: readFileNameSet(tsgo + "/submoduleTriaged.txt"),
  postEmitOrder: new Set(),
});
const rows = ["name\tsuite\tcasePath\tconfigName\tstatus\treason\tkind\ttags"];
for (const i of e.instances) rows.push([i.name, i.suite, i.casePath, i.configName, i.status, i.reason, i.kind ?? "", i.tags.join(",")].join("\t"));
await Bun.write(process.argv[2], rows.join("\n") + "\n");
const count = (f: (i: any) => boolean) => e.instances.filter(f).length;
console.log(JSON.stringify({
  instances: e.instances.length,
  run: count(i => i.status === "run"),
  skipped: count(i => i.status === "skipped"),
  invalid: count(i => i.status === "invalid"),
  E: count(i => i.kind === "E"),
  C: count(i => i.kind === "C"),
  E_compiler: count(i => i.kind === "E" && i.suite === "compiler"),
  E_conformance: count(i => i.kind === "E" && i.suite === "conformance"),
  C_compiler: count(i => i.kind === "C" && i.suite === "compiler"),
  C_conformance: count(i => i.kind === "C" && i.suite === "conformance"),
  accepted: count(i => i.tags.includes("accepted")),
  triaged: count(i => i.tags.includes("triaged")),
  skippedEmit: count(i => i.tags.includes("skipped-emit")),
  skippedEmitRun: count(i => i.tags.includes("skipped-emit") && i.status === "run"),
}));
