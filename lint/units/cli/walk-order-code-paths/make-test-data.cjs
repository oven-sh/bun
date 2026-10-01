// Research scratch: one text file with, for each of upstream's 243 fixtures of tests/fixtures/code-path-analysis:
//   == <name>            the file name of the fixture
//   | <line>             its source without the /*DOT ... */ blocks (the /*expected blocks stay: they are comments)
//   > <line>             the lines of its /*expected blocks; `>>` ends one block (one block per code path, in the order the paths end)
//   <op> [json args]     the calls that the analyzer makes on CodePathState for it (fixtures-trace.txt), one per line
// The trace is checked here against the expected blocks with upstream's own CodePathState (replay.cjs).
// usage: node make-test-data.cjs > code-path-analysis.txt
"use strict";
const fs = require("fs");
const path = require("path");
const { replayAll } = require("./replay.cjs");
const dir = "/workspace/ref/eslint/tests/fixtures/code-path-analysis";
const trace = fs.readFileSync(path.join(__dirname, "fixtures-trace.txt"), "utf8");
const replayed = replayAll(trace);
const ops = new Map();
let name = null;
for (const line of trace.split("\n")) {
	if (line.startsWith("== ")) { name = line.slice(3).replace(/\.cjs$/u, ".js"); ops.set(name, []); }
	else if (line !== "") ops.get(name).push(line);
}
const expectedPattern = /\/\*expected\s((?:.|[\r\n])+?)\*\//gu;
const out = [];
let bad = 0, blocks = 0;
for (const file of fs.readdirSync(dir).sort()) {
	const source = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/gu, "\n");
	const expected = [...source.matchAll(expectedPattern)].map(m => m[1].trim());
	const got = replayed.get(file.replace(/\.js$/u, ".cjs"));
	if (!got || !got.arrows || JSON.stringify(got.arrows) !== JSON.stringify(expected)) bad++;
	blocks += expected.length;
	const code = source.replace(/\/\*DOT\s(?:.|[\r\n])+?\*\/\n?/gu, "").replace(/\n+$/u, "\n");
	out.push(`== ${file}`);
	for (const line of code.split("\n").slice(0, -1)) out.push(`| ${line}`);
	for (const block of expected) { for (const line of block.split("\n")) out.push(`> ${line}`); out.push(">>"); }
	for (const op of ops.get(file)) out.push(op);
}
process.stdout.write(out.join("\n") + "\n");
process.stderr.write(`fixtures ${ops.size}, expected blocks ${blocks}, traces that do not give the expected arrows ${bad}\n`);
