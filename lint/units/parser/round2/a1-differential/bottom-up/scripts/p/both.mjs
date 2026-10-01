// node both.mjs <sources.json> : base and head side by side
import { execFileSync } from "node:child_process";
const M = "/workspace/notes/lint/measure/parser";
const run = bin => execFileSync(`${M}/${bin}/bun`, ["/tmp/a1bu/p/ar.mjs", process.argv[2]], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean).map(l => JSON.parse(l));
const b = run("base"), h = run("head");
for (let i = 0; i < b.length; i++) {
  console.log(JSON.stringify(b[i].src));
  for (let k = 0; k < b[i].out.length; k++) {
    const same = b[i].out[k] === h[i].out[k];
    console.log(same ? `     both ${b[i].out[k]}` : `     base ${b[i].out[k]}\n     head ${h[i].out[k]}`);
  }
}
