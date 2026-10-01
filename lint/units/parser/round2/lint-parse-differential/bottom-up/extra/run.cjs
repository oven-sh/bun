// Runs the lint-parse probe and tsc over a list of sources and prints one line for each.
//   node run.cjs <inputs.json> [lint|plain]      inputs: [[kind, source] ...], kind ts | tsx | js | jsx | dts
const fs = require("fs");
const cp = require("child_process");
const ts = require(process.env.ORACLE_TYPESCRIPT ?? "/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const PROBE = process.env.LINTPROBE ?? "/tmp/lpd-1a/target/debug/lintprobe";
const [inputsPath, options = "lint"] = process.argv.slice(2);
const inputs = JSON.parse(fs.readFileSync(inputsPath, "utf8"));
const tmp = fs.mkdtempSync("/tmp/lpd-extra-");
fs.writeFileSync(`${tmp}/in.hex`, inputs.map(([kind, src], i) => `${i} ${kind} ${Buffer.from(src, "utf8").toString("hex")}`).join("\n") + "\n");
cp.execFileSync(PROBE, [`${tmp}/in.hex`, `${tmp}/out.tsv`, options], { stdio: ["ignore", "ignore", "ignore"] });
const out = fs.readFileSync(`${tmp}/out.tsv`, "utf8").split("\n").filter(Boolean).map(l => l.split("\t"));
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX, dts: ts.ScriptKind.TS };
const names = { ts: "/a.ts", tsx: "/a.tsx", js: "/a.js", jsx: "/a.jsx", dts: "/a.d.ts" };
inputs.forEach(([kind, src], i) => {
  const diags = ts.createSourceFile(names[kind], src, ts.ScriptTarget.ESNext, false, kinds[kind]).parseDiagnostics;
  const d = diags[0];
  const tsc = d ? `TS${d.code}@${d.start}+${d.length} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}` : "ok";
  const f = out[i];
  const lint = f[1] === "ok" ? "ok" : f[1] === "panic" ? `PANIC ${unhex(f[2])}` : `${f[1] === "init" ? "init " : ""}${f[4] !== "0" ? `TS${f[4]}@${f[5]}..${f[6]}` : "no code"} bun@${f[2]}+${f[3]} ${unhex(f[8])}`;
  const cls = d ? (f[1] === "ok" ? "B " : "RR") : f[1] === "ok" ? "AA" : "A ";
  console.log(`${cls} ${kind.padEnd(3)} ${JSON.stringify(src)}\n      tsc: ${tsc}\n      lint: ${lint}`);
});
fs.rmSync(tmp, { recursive: true });
