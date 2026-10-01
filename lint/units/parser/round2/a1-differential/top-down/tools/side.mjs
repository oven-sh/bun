// usage: <bun under test> side.mjs <sources.txt> <out.json>    one source per line, U+23CE stands for a line break
import { readFileSync, writeFileSync } from "node:fs";
import { APIS } from "/tmp/a1td/gd/harness.mjs";
const DEFINE = { "process.env.NODE_ENV": '"development"' };
const want = (process.env.PROBE_APIS ?? "t.ts.plain,t.ts.deco,t.tsx.plain,t.ts.exp").split(",");
const apis = APIS.filter(a => want.includes(a[0]));
const transpilers = apis.map(([, , options]) => new Bun.Transpiler({ define: DEFINE, ...options }));
const srcs = readFileSync(process.argv[2], "utf8").split("\n").filter(l => l.length > 0 && !l.startsWith("# ")).map(l => l.replaceAll("\u23ce", "\n"));
const out = [];
for (const src of srcs) {
  const r = {};
  apis.forEach(([name, method], i) => {
    try {
      const v = transpilers[i][method](src);
      r[name] = ["o", typeof v === "string" ? v : JSON.stringify(v)];
    } catch (e) {
      const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e];
      r[name] = ["e", list.map(x => String(x?.message ?? x))];
    }
  });
  out.push({ src, r });
}
writeFileSync(process.argv[3], JSON.stringify({ revision: Bun.revision, apis: apis.map(a => a[0]), out }));
