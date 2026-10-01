// Research scratch: the 243 files of ESLint's tests/fixtures/code-path-analysis, through Bun's parser and the mapping
// of cpaprobe, against their /*expected blocks (the arrows that ESLint's own test compares).
// usage: node fixtures.cjs [--probe /tmp/cpa-1b/cpaprobe] [--show name.js]     exit 1 when a fixture differs.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { replayAll } = require("./replay.cjs");
const args = process.argv.slice(2);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const probe = opt("--probe") || "/tmp/cpa-1b/cpaprobe";
const show = opt("--show");
const dir = "/workspace/ref/eslint/tests/fixtures/code-path-analysis";
const expectedPattern = /\/\*expected\s((?:.|[\r\n])+?)\*\//gu;
const files = fs.readdirSync(dir).sort();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpa-fx-"));
// The name decides the loader of the probe: these files are scripts, `.cjs` keeps JSX out of them.
for (const file of files) fs.copyFileSync(path.join(dir, file), path.join(tmp, file.replace(/\.js$/u, ".cjs")));
const run = spawnSync(probe, files.map(f => f.replace(/\.js$/u, ".cjs")), {
	cwd: tmp,
	env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1" },
	encoding: "utf8",
	maxBuffer: 1 << 28,
});
if (run.status !== 0) console.log(`probe exit ${run.status} ${run.signal} ${run.stderr.slice(0, 2000)}`);
const results = replayAll(run.stdout);
let same = 0;
const bad = [];
for (const file of files) {
	const source = fs.readFileSync(path.join(dir, file), "utf8");
	const expected = [...source.matchAll(expectedPattern)].map(m => m[1].trim().replace(/\r?\n/gu, "\n"));
	const got = results.get(file.replace(/\.js$/u, ".cjs"));
	if (show === file) {
		console.log(JSON.stringify({ expected, got }, null, 1));
	}
	if (got && got.arrows && JSON.stringify(got.arrows) === JSON.stringify(expected)) same++;
	else bad.push([file, got && got.error ? got.error.split("\n").slice(0, 3).join(" | ") : "arrows differ"]);
}
fs.rmSync(tmp, { recursive: true, force: true });
for (const [file, why] of bad) console.log(`DIFF ${file}: ${why}`);
console.log(`fixtures ${files.length}, the same ${same}, different ${bad.length}`);
process.exit(bad.length ? 1 : 0);
