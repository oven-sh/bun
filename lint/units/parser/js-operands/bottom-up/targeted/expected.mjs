// usage: <bun> expected.mjs > expected.txt : what a lint parse of each input as a JavaScript file must give.
// Tree and parse diagnostics: tsc 6.0.2 (equal to typescript-go on every input). JavaScript-only diagnostics: typescript-go.
import { readFileSync } from "node:fs";
import { inputs } from "./inputs.mjs";
const tsc = JSON.parse(readFileSync(new URL("./tsc.json", import.meta.url), "utf8")).rows;
const go = JSON.parse(readFileSync(new URL("./tsgo.json", import.meta.url), "utf8")).rows;
const bun = JSON.parse(readFileSync(new URL("./bun.json", import.meta.url), "utf8")).rows;
for (const [id, code] of inputs) {
  const T = tsc[id]["a.js"], G = go[id]["a.js"], B = bun[id];
  const V = tsc[id].v8; const valid = V.script === "ok" ? "script" : V.module === "ok" ? "module" : "no";
  console.log(`${id}\t${JSON.stringify(code)}`);
  console.log(`\tvalid JavaScript (V8): ${valid}\tbase bun: js=${B.js.ok ? "ok" : "error"} jsx=${B.jsx.ok ? "ok" : "error"} ts=${B.ts.ok ? "ok" : "error"} tsx=${B.tsx.ok ? "ok" : "error"}${B.jsx.ok && B.tsx.ok && B.jsx.out !== B.tsx.out ? " (jsx and tsx outputs differ)" : ""}`);
  console.log(`\ttree: ${T.tree}`);
  console.log(`\tparse: ${G.parse.length ? G.parse.map((d, i) => `${d} ${T.parseText[i] ?? ""}`).join(" | ") : "clean"}`);
  if (G.js.length) console.log(`\tjavascript-only: ${G.js.join(" | ")}`);
  const tj = T.js.map(x => x.split(" ")[0]).join(","), gj = G.js.map(x => x.split(" ")[0]).join(",");
  if (tj !== gj) console.log(`\t(tsc 6.0.2 reports instead: ${tj || "nothing"})`);
}
