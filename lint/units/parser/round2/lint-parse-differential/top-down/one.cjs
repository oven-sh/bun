// usage: node one.cjs [--kind=ts|tsx|js|jsx|dts] [--plain] [--bin=<probe binary>] <source>...   ("\\n" in a source is a line break)
// Prints, for each source, the lint parse of the probe (zz_probe.rs; default options: those of `bun --lint`, --plain: those of the tests of the crate) and the parse diagnostics of tsc 6.0.2.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const ts = require("/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const args = process.argv.slice(2);
const kind = (args.find(a => a.startsWith("--kind=")) ?? "--kind=ts").slice(7);
const plain = args.includes("--plain");
const bin = (args.find(a => a.startsWith("--bin=")) ?? "--bin=/tmp/lpd1b/scratch/out/bun_js_parser").slice(6);
const srcs = args.filter(a => !a.startsWith("--")).map(s => s.replaceAll("\\n", "\n"));
const tag = process.pid;
fs.writeFileSync(`${require("node:os").tmpdir()}/lpd-one.${tag}.hex`, srcs.map((s, i) => `${i} ${kind} ${Buffer.from(s, "utf8").toString("hex")}`).join("\n") + "\n");
const env = { ...process.env, SMPH_INPUTS: `${require("node:os").tmpdir()}/lpd-one.${tag}.hex`, SMPH_OUT: `${require("node:os").tmpdir()}/lpd-one.${tag}.tsv` };
if (!plain) { env.SMPH_TLA = "1"; env.SMPH_STANDARD_DECORATORS = "1"; }
const p = spawnSync(bin, ["zz_probe"], { env });
if (p.status !== 0) console.error("probe status", p.status, String(p.stderr).slice(-400));
const unhex = h => Buffer.from(h ?? "", "hex").toString("utf8");
const out = fs.readFileSync(`${require("node:os").tmpdir()}/lpd-one.${tag}.tsv`, "utf8").split("\n").filter(Boolean).map(l => l.split("\t"));
const sk = { ts: ts.ScriptKind.TS, dts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX }[kind];
const name = { ts: "/a.ts", dts: "/a.d.ts", tsx: "/a.tsx", js: "/a.js", jsx: "/a.jsx" }[kind];
for (const f of out) {
  const s = srcs[Number(f[0])];
  const d = ts.createSourceFile(name, s, ts.ScriptTarget.ESNext, false, sk).parseDiagnostics.map(x => `TS${x.code}@${x.start}+${x.length} ${ts.flattenDiagnosticMessageText(x.messageText, " ")}`);
  const lint = f[1] === "ok" ? "ok" : `${f[1]} TS${f[4]}@${f[5]}..${f[6]} [bun@${f[2]}+${f[3]} ${JSON.stringify(unhex(f[8]))}] msgs=${f[7]}`;
  console.log(JSON.stringify(s));
  console.log("    lint:", lint);
  console.log("    tsc :", d.length ? d.join(" | ") : "ok");
}
fs.rmSync(`${require("node:os").tmpdir()}/lpd-one.${tag}.hex`); fs.rmSync(`${require("node:os").tmpdir()}/lpd-one.${tag}.tsv`);
