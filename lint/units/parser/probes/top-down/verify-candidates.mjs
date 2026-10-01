#!/usr/bin/env bun
// Runs every row of results/test-candidates.json.gz through the bun that runs this script.
// A row passes when the input prints the recorded output. On the probed bun no row passes.
// usage: bun verify-candidates.mjs   (with a new build: bun bd verify-candidates.mjs)
import fs from "node:fs";
import zlib from "node:zlib";
const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL("./results/test-candidates.json.gz", import.meta.url))).toString());
const T = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  deco: new Bun.Transpiler({ loader: "ts", tsconfig: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } } }),
};
let fails = 0, passes = 0, twinMismatch = 0;
const passing = [];
for (const [group, list] of Object.entries(data)) {
  for (const c of list) {
    const t = c.decorators ? T.deco : T[c.loader];
    let actual;
    try { actual = t.transformSync(c.input); } catch { actual = null; }
    if (actual === c.output) { passes++; passing.push(c.input); } else fails++;
    let twinOut;
    try { twinOut = t.transformSync(c.twin); } catch { twinOut = null; }
    if (twinOut !== c.output) twinMismatch++;
  }
}
console.log({ rows: fails + passes, failOnInstalledBun: fails, passOnInstalledBun: passes, twinDoesNotPrintExpected: twinMismatch });
console.log(passing.slice(0, 5));
