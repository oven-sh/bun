// usage: node forms.mjs <diff.jsonl> <regex of cause> [max forms per cause]
// Lists, per cause, the distinct type forms (or whole sources) with their contexts, the first message of the base and the codes of tsc.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
const [path, pattern, maxArg] = process.argv.slice(2);
const re = new RegExp(pattern);
const max = Number(maxArg ?? 1000);
const byCause = new Map();
const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  // cheap prefilter on the head of the line
  const head = line.slice(0, 200);
  const m = /^\{"cause":"((?:[^"\\]|\\.)*)"/.exec(head);
  if (!m || !re.test(m[1])) continue;
  const d = JSON.parse(line);
  if (!byCause.has(d.cause)) byCause.set(d.cause, new Map());
  const forms = byCause.get(d.cause);
  const key = d.t ?? d.src;
  if (!forms.has(key)) forms.set(key, { ctx: new Set(), apis: new Set(), base: d.base, next: d.next, tsc: d.tsc, isForm: d.t != null, srcs: new Set() });
  const f = forms.get(key);
  f.ctx.add(d.ctx ?? "-");
  f.apis.add(d.api);
  f.srcs.add(d.src);
}
for (const [cause, forms] of [...byCause].sort()) {
  let records = 0;
  console.log(`\n## ${cause}   (${forms.size} forms)`);
  let n = 0;
  for (const [key, f] of forms) {
    if (n++ >= max) { console.log("   ..."); break; }
    const dialect = [...f.apis].some(a => !a.includes(".tsx.")) ? "ts" : "tsx";
    const parse = (f.tsc?.[dialect] ?? []).map(x => `TS${x[0]}@${x[1]}`).join(",");
    const chk = (f.tsc?.chk?.[dialect] ?? []).map(x => `TS${x[0]}`).join(",");
    const oth = (f.tsc?.oth?.[dialect] ?? []).map(x => `TS${x}`).join(",");
    const baseMsg = f.base[0] === "e" ? f.base[1].map(e => e[0]).join(" | ") : f.base[0];
    console.log(`  ${f.isForm ? "T" : "S"} ${JSON.stringify(key)}  ctx[${[...f.ctx].join(",")}] apis:${f.apis.size} srcs:${f.srcs.size}${parse ? "  parse:" + parse : ""}${chk ? "  chk:" + chk : ""}${oth ? "  oth:" + oth : ""}\n       base: ${baseMsg.slice(0, 160)}`);
  }
}
