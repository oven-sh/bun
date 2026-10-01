// usage: node condense.cjs <out file of probe.cjs> [group regexp]
// One line for each input: source | first diagnostic of typescript-go (and of tsc when it differs) | what bun did.
const { parse } = require("./parse.cjs");
const recs = parse(process.argv[2]);
const re = process.argv[3] ? new RegExp(process.argv[3]) : null;
let g = null;
for (const r of recs) {
  if (re && !re.test(r.g)) continue;
  if (r.g !== g) { g = r.g; console.log("## " + g); }
  const go = r.goOk ? "parses" : (r.go[0] ?? "?");
  const tsc = r.tscOk ? "parses" : r.tsc.length ? r.tsc[0] : "parses; checker " + (r.chk[0] ?? "");
  const short = s => s.replace(/^(@\d+\+\d+ TS\d+) (.*)$/, (m, a, b) => a + " " + (b.length > 60 ? b.slice(0, 57) + "..." : b));
  const bun = r.bunKind === "accepts" ? "ACCEPTS" : (r.bunKind === "visit" ? "VISIT " : "") + (r.bun[0] ?? "?");
  const tscPart = (r.tscOk && r.goOk) || r.tsc[0] === r.go[0] ? "" : "  [tsc: " + short(tsc) + "]";
  console.log(JSON.stringify(r.s) + (r.l !== "ts" ? " [" + r.l + "]" : "") + "  =>  " + short(go) + tscPart + "  ||  " + bun);
}
