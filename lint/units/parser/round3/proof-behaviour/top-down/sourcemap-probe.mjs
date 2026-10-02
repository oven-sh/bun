// Scratch: source maps of a bundle of each corpus source, as a record per source: what Bun.build gives for one entry point.
//   <bun under test> smprobe.mjs <corpus.json> <out.jsonl> [tsx]
import { mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [corpusPath, outPath, ext = "ts"] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const inputs = [];
for (const f of corpus.forms) for (const [ctx, template] of Object.entries(corpus.contexts)) inputs.push(template.replace("%T%", () => f.t));
for (const s of corpus.sources) inputs.push(s.src);
const dir = join(process.cwd(), "work");
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "in"), { recursive: true });
writeFileSync(outPath, "");
let buffer = "";
for (let i = 0; i < inputs.length; i++) {
  const file = join(dir, "in", `f.${ext}`);
  writeFileSync(file, inputs[i]);
  const outdir = join(dir, "out");
  rmSync(outdir, { recursive: true, force: true });
  let record;
  try {
    const result = await Bun.build({ entrypoints: [file], outdir, sourcemap: "external", target: "bun", packages: "external", throw: false });
    if (!result.success) {
      record = { i, e: result.logs.map(l => [String(l.message), l.level, l.position?.line ?? null, l.position?.column ?? null]) };
    } else {
      const js = existsSync(join(outdir, "f.js")) ? readFileSync(join(outdir, "f.js"), "utf8") : null;
      const map = existsSync(join(outdir, "f.js.map")) ? JSON.parse(readFileSync(join(outdir, "f.js.map"), "utf8")) : null;
      record = { i, js, mappings: map?.mappings ?? null, names: map?.names ?? null, w: result.logs.map(l => [String(l.message), l.level, l.position?.line ?? null, l.position?.column ?? null]) };
    }
  } catch (e) {
    record = { i, threw: String(e?.message ?? e).slice(0, 300) };
  }
  buffer += JSON.stringify({ src: inputs[i], ...record }) + "\n";
  if (buffer.length > 1 << 16) { appendFileSync(outPath, buffer); buffer = ""; }
}
appendFileSync(outPath, buffer);
rmSync(dir, { recursive: true, force: true });
console.log(outPath, inputs.length, "sources", Bun.revision.slice(0, 10));
