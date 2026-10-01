// The reader on generated baselines: write(read(text)) against text, where text = write(case).
// usage: bun reader_fuzz.ts <count> <seed> <sane|tricky> <alone|units> <plain|library|repeated|all> <lf|all>
import { WriterPanic, compareDiagnostics, tsgoRules } from "./diagnosticwriter";
import { getErrorBaseline } from "./error_baseline";
import { genCase, generator, setSeed } from "./crosscheck_go";
import { ReadError, readErrorBaseline } from "./reader";

const count = Number(process.argv[2] ?? 5000);
setSeed(Number(process.argv[3] ?? 1));
generator.sane = (process.argv[4] ?? "sane") === "sane";
const withUnits = process.argv[5] === "units";
generator.names = process.argv[6] ?? "plain";
generator.breaks = process.argv[7] ?? "lf";
generator.valid = (process.argv[8] ?? "valid") === "valid";
const rules = tsgoRules;

let written = 0;
let panics = 0;
let ok = 0;
const kinds: Record<string, { n: number; examples: string[] }> = {};
const note = (k: string, example: string) => {
  const e = (kinds[k] ??= { n: 0, examples: [] });
  e.n++;
  if (e.examples.length < 12) e.examples.push(example);
};
for (let k = 0; k < count; k++) {
  const c = genCase(k, false);
  c.diagnostics = c.diagnostics.slice().sort((a, b) => compareDiagnostics(rules, a, b));
  let text: string;
  try {
    const w = getErrorBaseline(rules, c.inputs, c.diagnostics, c.pretty);
    if (c.diagnostics.length === 0) continue;
    text = w.text;
  } catch (e) {
    if (!(e instanceof WriterPanic)) throw e;
    panics++;
    continue;
  }
  written++;
  const features: string[] = [];
  if (c.pretty) features.push("pretty");
  if (c.pretty && c.diagnostics.some(d => d.relatedInformation.some(r => r.file !== undefined && !c.inputs.some(f => f.unitName === r.file!.fileName)))) {
    features.push("related file without section");
  }
  const names = c.inputs.map(f => f.unitName.toLowerCase());
  if (new Set(names).size !== names.length) features.push("repeated name");
  if (c.inputs.some(f => /lib\..*d\.ts$/.test(f.unitName))) features.push("library unit");
  if (c.inputs.some(f => rules.model.lineStarts(f.content).length !== rules.model.splitLines(f.content).length)) {
    features.push("more line starts than lines");
  }
  if (c.inputs.some(f => /\r/.test(f.content))) features.push("CR");
  if (c.diagnostics.some(d => d.file !== undefined && !c.inputs.some(f => f.content === d.file!.text && f.unitName === d.file!.fileName))) {
    features.push("file without section");
  }
  if (c.diagnostics.some(d => d.relatedInformation.some(r => r.messageChain.length > 0 || /\n/.test(r.messageText)))) {
    features.push("related chain");
  }
  const tag = features.length === 0 ? "plain" : features.join("+");
  try {
    const parsed = readErrorBaseline(rules, text, withUnits ? { units: c.inputs } : {});
    const again = getErrorBaseline(rules, withUnits ? c.inputs : parsed.files, parsed.diagnostics, parsed.pretty);
    if (again.text === text) {
      ok++;
      note("ok: " + tag, c.name);
    } else {
      const a = text.split("\r\n");
      const b = again.text.split("\r\n");
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      note("bytes differ: " + tag, `${c.name} line ${i + 1}: ${JSON.stringify(a[i])?.slice(0, 90)} against ${JSON.stringify(b[i])?.slice(0, 90)}`);
    }
  } catch (e) {
    if (e instanceof ReadError) note("reader error: " + tag, `${c.name}: ${e.message.slice(0, 140)}`);
    else if (e instanceof WriterPanic) note("writer panic after read: " + tag, `${c.name}: ${e.message.slice(0, 140)}`);
    else throw e;
  }
}
console.log(
  `== ${count} cases, ${panics} writer panics, ${written} baselines, ${ok} round trip (${generator.sane ? "sane" : "tricky"} messages, ${withUnits ? "with units" : "alone"}, names ${generator.names}, breaks ${generator.breaks})`,
);
for (const k of Object.keys(kinds).sort()) {
  if (k.startsWith("ok: ")) continue;
  console.log(`  ${kinds[k].n}  ${k}`);
  for (const x of kinds[k].examples) console.log(`        ${x}`);
}
const okKinds = Object.keys(kinds).filter(k => k.startsWith("ok: "));
console.log("  round trips by feature:", okKinds.map(k => `${k.slice(4)}=${kinds[k].n}`).join(", "));
