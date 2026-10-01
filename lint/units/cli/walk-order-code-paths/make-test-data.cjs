// Research scratch: one text file for the Rust tests of src/lint/code_path_analysis. For each entry:
//   == <name>            the 243 fixtures of upstream's tests/fixtures/code-path-analysis, then own--*.js, then unit--*.js
//                        (the sources that upstream's tests code-path.js and code-path-analyzer.js give to the linter)
//   | <line>             its source (of a fixture: without the /*DOT ... */ blocks)
//   > <line>             the arrows of each code path in the order the paths end (debug-helpers makeDotArrows); `>>` ends one path
//   ! <event>            every code path event in order, without its node
//   <op> [json args]     the calls on CodePathState that the walk makes for it; `F` is forwardCurrentToHead,
//                        `F-unless-reachable` the exit of a SwitchCase, `start <origin>` / `end` a code path
// Checked while the file is made: the calls give these arrows and events on upstream's own CodePathState (replay.cjs),
// the arrows of a fixture are its /*expected blocks, and the arrows and events of every entry are ESLint's (oracle.cjs).
// usage: node make-test-data.cjs > code-path-analysis.txt      (needs the probe: /tmp/wocp/cpaprobe)
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { replayAll } = require("./replay.cjs");
const { oracle } = require("./oracle.cjs");
const dir = "/workspace/ref/eslint/tests/fixtures/code-path-analysis";
const expectedPattern = /\/\*expected\s((?:.|[\r\n])+?)\*\//gu;
const ownNames = ["remove-missing-1", "remove-missing-2", "remove-missing-3", "finally-in-finally", "finally-leaving-paths", "continue-outer-label", "try-catch-return", "finally-break-continue"];
const entries = [];
for (const file of fs.readdirSync(dir).sort()) {
	const source = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/gu, "\n");
	const expected = [...source.matchAll(expectedPattern)].map(m => m[1].trim());
	entries.push({ name: file, source, code: source.replace(/\/\*DOT\s(?:.|[\r\n])+?\*\/\n?/gu, "").replace(/\n+$/u, "\n"), expected });
}
JSON.parse(fs.readFileSync(path.join(__dirname, "cases/own-code-paths.json"), "utf8")).forEach((c, i) => entries.push({ name: `own--${ownNames[i]}.js`, source: c.code + "\n", code: c.code + "\n" }));
const unit = [];
for (const [file, pattern] of [["code-path.js", /parseCodePaths\(\s*("(?:[^"\\]|\\.)*")/gu], ["code-path-analyzer.js", /linter\.verify\(\s*("(?:[^"\\]|\\.)*")/gu]]) {
	const text = fs.readFileSync(path.join("/workspace/ref/eslint/tests/lib/linter/code-path-analysis", file), "utf8");
	for (const m of text.matchAll(pattern)) { const code = JSON.parse(m[1]); if (!unit.includes(code)) unit.push(code); }
}
unit.forEach((code, i) => entries.push({ name: `unit--${String(i + 1).padStart(2, "0")}.js`, source: code + "\n", code: code + "\n" }));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpa-data-"));
entries.forEach((e, i) => fs.writeFileSync(path.join(tmp, `c${i}.cjs`), e.source));
const run = spawnSync("/tmp/wocp/cpaprobe", entries.map((e, i) => `c${i}.cjs`), { cwd: tmp, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1" }, encoding: "utf8", maxBuffer: 1 << 28 });
fs.rmSync(tmp, { recursive: true, force: true });
const ops = new Map();
let name = null;
for (const line of run.stdout.split("\n")) {
	if (line.startsWith("== ")) { name = line.slice(3); ops.set(name, []); } else if (line !== "") ops.get(name).push(line);
}
const replayed = replayAll(run.stdout);
const out = [];
let bad = 0, paths = 0, events = 0, calls = 0;
entries.forEach((e, i) => {
	const got = replayed.get(`c${i}.cjs`);
	const es = oracle(e.source, { sourceType: "script" });
	const same = got && got.arrows && !es.error && JSON.stringify(got.arrows) === JSON.stringify(es.arrows) && JSON.stringify(got.events) === JSON.stringify(es.events) && (!e.expected || JSON.stringify(got.arrows) === JSON.stringify(e.expected));
	if (!same) { bad++; process.stderr.write(`NOT THE SAME: ${e.name}\n`); return; }
	out.push(`== ${e.name}`);
	for (const line of e.code.split("\n").slice(0, -1)) out.push(`| ${line}`);
	for (const block of got.arrows) { for (const line of block.split("\n")) out.push(`> ${line}`); out.push(">>"); }
	for (const event of got.events) out.push(`! ${event}`);
	for (const op of ops.get(`c${i}.cjs`)) out.push(op);
	paths += got.arrows.length; events += got.events.length; calls += ops.get(`c${i}.cjs`).length;
});
process.stdout.write(out.join("\n") + "\n");
process.stderr.write(`entries ${entries.length} (fixtures 243, own ${ownNames.length}, unit ${unit.length}), code paths ${paths}, events ${events}, calls ${calls}, entries that are not the same ${bad}\n`);
