import { readFileSync } from "node:fs";
import { recordOf } from "/tmp/a1td/gd/oracle.mjs";
import { tagOf } from "/tmp/a1td/probes/metadata.mjs";
import { bunMetadataOf } from "/tmp/a1td/gd/causes.mjs";
const [basePath, headPath] = process.argv.slice(2);
const base = JSON.parse(readFileSync(basePath, "utf8"));
const head = JSON.parse(readFileSync(headPath, "utf8"));
const show = v => (v[0] === "e" ? "R " + JSON.stringify(v[1][0]) + (v[1].length > 1 ? ` +${v[1].length - 1}` : "") : "A");
const meta = v => (v[0] === "o" ? bunMetadataOf(v[1]).map(([k, x]) => k.slice(7) + "=" + tagOf(x)).join("; ") : "");
for (let i = 0; i < base.out.length; i++) {
  const b = base.out[i];
  const h = head.out[i];
  const o = recordOf(b.src);
  const line = [];
  for (const api of base.apis) {
    const bv = b.r[api];
    const hv = h.r[api];
    const same = JSON.stringify(bv) === JSON.stringify(hv);
    let s = `${api}: ${show(bv)}${same ? " ==" : " -> " + show(hv)}`;
    if (api.includes("deco")) {
      const bm = meta(bv);
      const hm = meta(hv);
      if (bm || hm) s += `  meta[${bm}]${bm === hm ? "" : " -> [" + hm + "]"}`;
    }
    line.push(s);
  }
  const d = k => (o[k] ?? []).map(x => "TS" + x[0]).join(",");
  const chk = k => (o.chk?.[k] ?? []).map(x => "TS" + x[0]).join(",");
  const tscMeta = (o.metaLoose ?? o.meta ?? []).map(([k, x]) => k.slice(7) + "=" + tagOf(x)).join("; ");
  console.log(`${JSON.stringify(b.src)}\n    tsc: parse.ts[${d("ts")}] parse.tsx[${d("tsx")}] chk.ts[${chk("ts")}]${o.chk?.tsL ? " chk.tsL[" + chk("tsL") + "]" : ""} chk.tsx[${chk("tsx")}] oth[${(o.oth?.ts ?? []).join(",")}]${tscMeta ? " meta[" + tscMeta + "]" : ""}\n    ${line.join("\n    ")}`);
}
