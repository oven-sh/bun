
// Runs the rebuild proof over every TypeScript file under the given directories.
const fs = require("fs"), path = require("path");
const { run } = require("./rebuild.cjs");
let pass = 0, fail = 0, skipped = 0, wrappers = 0, parens = 0;
const fails = [];
function walk(d) {
  let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(f); continue; }
    if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
    let src; try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
    if (src.length > 400000) continue;
    let r;
    try { r = run(src, e.name.endsWith(".tsx") ? "t.tsx" : "t.ts"); } catch (err) { r = { ok: false, error: String(err.message) }; }
    if (r.skip) { skipped++; continue; }
    if (r.ok) { pass++; for (const x of r.rebuilt) { if (x.startsWith("Paren")) parens++; else wrappers++; } }
    else { fail++; if (fails.length < 25) fails.push([f, r]); }
  }
}
for (const d of process.argv.slice(2)) walk(d);
console.log(`files pass ${pass} fail ${fail} skipped(tsc rejects) ${skipped}; rebuilt wrappers ${wrappers} parentheses ${parens}`);
for (const [f, r] of fails) {
  const exp = new Set(r.expected || []), got = new Set(r.rebuilt || []);
  const missing = [...exp].filter(x => !got.has(x)).slice(0, 4), extra = [...got].filter(x => !exp.has(x)).slice(0, 4);
  console.log("FAIL " + f + (r.error ? "  error: " + r.error : "") + "\n   missing " + missing.join(" ") + "\n   extra   " + extra.join(" "));
}
