import fs from "node:fs";
const load = f => new Map(fs.readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l)).map(r => [r.key, r]));
const files = process.argv.slice(2);
const sets = files.map(load);
const CBS = { "write x3": ["w0", "w1", "w2"], "proto.write x3": ["w0", "w1", "w2"], "write,proto.write,write": ["w0", "w1", "w2"], "proto.write,write": ["w0", "w1"], "write,end(chunk,cb)": ["w0", "end"], "write,write,end(cb)": ["w0", "w1", "end"], "write,write('',cb),end(cb)": ["w0", "w1", "end"], "write,write,destroy()": ["w0", "w1"], "write,write,end(cb),destroy()": ["w0", "w1", "end"] };
function verdict(r) {
  if (!r) return ["<absent>"];
  const seq = r.key.split(" | ")[2]; const ev = r.ev; const v = [];
  if (ev.some(e => e.startsWith("<no report"))) return [ev[0]];
  if (ev.some(e => e.startsWith("INSIDE:"))) v.push("C1");
  const names = ev.map(e => e.replace("INSIDE:", "").split(":")[0]);
  const cbs = CBS[seq]; const writes = cbs.filter(c => c !== "end");
  const seen = names.filter(n => writes.includes(n));
  if (seen.join() !== writes.filter(n => seen.includes(n)).join()) v.push("C2");
  const destroyed = /destroy/.test(seq);
  const lastWrite = Math.max(...writes.map(n => names.lastIndexOf(n)));
  if (!destroyed) {
    if (names.indexOf("end") >= 0 && names.indexOf("end") < lastWrite) v.push("C3end");
    if (names.indexOf("finish") >= 0 && names.indexOf("finish") < lastWrite) v.push("C3finish");
  }
  for (const c of cbs) { const n = names.filter(x => x === c).length; if (n === 0 && !(destroyed && c === "end")) v.push("C4never:" + c); if (n > 1) v.push("C4dup:" + c); }
  return v;
}
const base = sets[0];
const counts = files.map(() => 0);
for (const key of base.keys()) {
  const vs = sets.map(s => verdict(s.get(key)));
  vs.forEach((v, i) => { if (v.length) counts[i]++; });
  if (vs.some(v => v.length)) console.log(key.padEnd(52), vs.map((v, i) => `${files[i].replace(/^out-|\.jsonl$/g, "")}: ${v.join("+") || "ok"}  [${sets[i].get(key)?.ev.join(" ")}]`).join("\n" + " ".repeat(53)));
}
console.log("rows", base.size, "failing:", files.map((f, i) => `${f.replace(/^out-|\.jsonl$/g, "")}=${counts[i]}`).join(" "));
