import { readFileSync } from "node:fs";
const NOISE = new Set([2304, 2307, 2503, 2564, 7006, 2693, 1225, 2842, 2314, 2315, 2318, 2322, 2339, 2345, 2355, 2391, 2552, 2583, 2584, 2695, 2711, 2749, 7005, 7008, 7010, 7019, 7031, 7034, 2300, 2451, 6133, 2365, 2367, 2882, 1108]);
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends finally for function if in instanceof return super switch throw try var while with".split(" "));
const undeclarable = d => d[0] === 2304 && (/^Cannot find name '#/.test(d[3]) || RESERVED.has(/^Cannot find name '([^']+)'/.exec(d[3])?.[1]));
const SHORT = { alias: "al", var: "va", field: "fi", param: "pa", ctor: "ct", ret: "re", fnparam: "fp", fnret: "fr", arrowparam: "ap", arrowret: "ar", ternary: "te", as: "as", satisfies: "sa", angle: "an", targ: "ta", tparam: "tp", heritage: "he", iextends: "ie", "-": "-" };
const byForm = new Map();
for (const line of readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(line);
  const key = r.t ?? r.src;
  if (!byForm.has(key)) byForm.set(key, { t: key, prod: r.prod, mut: r.mut, verdicts: new Map(), base: new Map() });
  const f = byForm.get(key);
  const w = r.ts;
  let verdict;
  if (w.parse.length) verdict = "P" + [...new Set(w.parse.map(d => d[0]))].join(",");
  else {
    const bad = [...new Set(w.sem.filter(d => !NOISE.has(d[0]) || undeclarable(d)).map(d => d[0] + (undeclarable(d) ? "!" : "")))];
    verdict = bad.length ? "S" + bad.join(",") : "ok";
  }
  f.verdicts.set(verdict, (f.verdicts.get(verdict) ?? []).concat(SHORT[r.ctx ?? "-"]));
  const msg = r.base[1][0][0];
  f.base.set(msg, (f.base.get(msg) ?? 0) + 1);
}
const rows = [...byForm.values()].sort((a, b) => (a.prod + a.t > b.prod + b.t ? 1 : -1));
for (const f of rows) {
  const v = [...f.verdicts].map(([k, c]) => `${k}:${c.length > 6 ? c.length : c.join("")}`).join(" ");
  const top = [...f.base].sort((a, b) => b[1] - a[1])[0];
  console.log(`${f.prod}${f.mut ? "*" : ""}\t${JSON.stringify(f.t)}\t${v}\t${top[0]}`);
}
