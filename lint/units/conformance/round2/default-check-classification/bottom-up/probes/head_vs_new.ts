import { classify } from "./classify";
const recs = (await Bun.file("raw-release-full.jsonl").text()).split("\n").filter(l => l !== "").map(l => JSON.parse(l));
let headCrash = { E: 0, C: 0 }, headPass = { E: 0, C: 0 }, headFailNothing = 0, headUnsup = 0;
const byDir = new Map<string, any>();
const multi = { syntaxInMulti: 0 };
let warnOnly: string[] = [];
for (const r of recs) {
  const c = classify(r);
  const named = /(^|\n)(?:\S.*?\(\d+,\d+\): )?(?:error|warning|suggestion|message) [A-Za-z@][A-Za-z0-9@\/_-]*: /.test(r.stderr ?? "");
  if (r.notLaid !== undefined) headUnsup++;
  else if (named) headCrash[r.kind as "E" | "C"]++;
  else if (r.kind === "C") headPass.C++;
  else headFailNothing++;
  if (c.rules) console.log(`rules: ${r.kind} ${r.name} (${r.casePath}) -> ${c.outcome} [${c.cause}] ${JSON.stringify(c.rules)} roots=${JSON.stringify(r.roots)}\n   ${(r.stderr ?? "").trim().split("\n").join("\n   ")}`);
  if (c.cause === "syntax" && c.cats === "warning") warnOnly.push(`${r.kind} ${r.name}: ${(r.stderr ?? "").split("\n")[0]}`);
  const top = r.casePath.split("/")[0];
  const d = byDir.get(top) ?? { run: 0, result: 0, crash: 0, timeout: 0, Cpass: 0, C: 0, Epass: 0, E: 0, syntax: 0 };
  d.run++; d[r.kind]++;
  if (["pass", "fail", "provisional", "compare"].includes(c.outcome)) d.result++;
  if (c.outcome === "crash") d.crash++;
  if (c.outcome === "timeout") d.timeout++;
  if (c.outcome === "pass") d[r.kind + "pass"]++;
  if (c.cause === "syntax") d.syntax++;
  byDir.set(top, d);
}
console.log("HEAD rules on the same runs: crash", JSON.stringify(headCrash), "C pass", headPass.C, "E fail nothing", headFailNothing, "unsupported", headUnsup);
console.log("warnings only:", warnOnly.length); for (const w of warnOnly) console.log("  ", w.slice(0, 200));
console.log(JSON.stringify(Object.fromEntries(byDir)));
const exits = new Map<string, number>();
for (const r of recs) { const k = `exit ${r.exitCode} signal ${r.signal} stdout ${r.stdout === "" || r.stdout === undefined ? "empty" : "text"}${r.notLaid !== undefined ? " notLaid" : ""}${r.threw ? " threw" : ""}`; exits.set(k, (exits.get(k) ?? 0) + 1); }
console.log([...exits]);
const slow = recs.filter(r => (r.ms ?? 0) > 2000).map(r => `${r.name} ${r.ms}ms`);
console.log("slower than 2 s:", slow);
