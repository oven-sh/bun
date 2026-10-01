// bun meta1.mjs <sources.txt>: design:* metadata of base, head and tsc (loose) per source.
import { spawnSync } from "node:child_process";
import { bunMetadataOf } from "/tmp/gdr1a/gd/causes.mjs";
import { recordOf } from "/tmp/gdr1a/gd/oracle.mjs";
const file = process.argv[2];
const BASE = "/workspace/notes/lint/measure/parser/base/bun";
const HEAD = process.env.HEAD_BIN ?? "/workspace/notes/lint/measure/parser/head/bun";
const run = bin => spawnSync(bin, ["/tmp/gdr1a/an/one.mjs", file], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout.split("\n").filter(Boolean).map(l => JSON.parse(l));
const b = run(BASE), h = run(HEAD);
const fmt = v => (v[0] === "e" ? "R " + v[1][0] : bunMetadataOf(v[1]).map(([k, x]) => `${k.replace("design:", "")}=${x}`).join("; "));
for (let i = 0; i < b.length; i++) {
  const o = recordOf(b[i].src);
  const t = o.metaLoose ?? o.meta;
  console.log(`${JSON.stringify(b[i].src)}\n   base: ${fmt(b[i].deco)}\n   head: ${fmt(h[i].deco)}\n   tsc : ${t ? t.map(([k, x]) => `${k.replace("design:", "")}=${x}`).join("; ") : "(no emit) " + JSON.stringify(o.ts.slice(0, 1))}${o.metaLoose ? "\n   tsc strict: " + o.meta.map(([k, x]) => `${k.replace("design:", "")}=${x}`).join("; ") : ""}`);
}
