// usage: node all-rows.mjs <runtime> [stream-filter]   runs every row of the fixture under <runtime>, prints one JSON line per row
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const FIX = "/tmp/c3/fixture-head.js";
const { sequences } = require(FIX);
const rt = process.argv[2];
const filter = process.argv[3] ?? "";
for (const stream of ["stdout", "stderr", "child.stdin"]) {
  if (filter && !stream.includes(filter)) continue;
  for (const state of ["idle", "parked", "failing", "broken"]) {
    for (const [sequence, { states }] of Object.entries(sequences)) {
      if (!(states ?? ["idle", "parked", "failing"]).includes(state)) continue;
      if (state === "failing" && sequence.includes("destroy()")) continue;
      const r = spawnSync(rt, [FIX, stream, state, sequence], { encoding: "utf8", timeout: 20000, env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } });
      const text = (stream === "stdout" ? r.stderr : r.stdout).trim().split("\n").at(-1);
      let report;
      try { report = JSON.parse(text); } catch { report = ["<no report: status " + r.status + " signal " + r.signal + ">"]; }
      console.log(JSON.stringify({ key: `${stream} | ${state} | ${sequence}`, report }));
    }
  }
}
