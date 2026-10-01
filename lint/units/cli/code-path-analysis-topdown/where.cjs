// Research scratch: where the events of ESLint and of the mapping first differ in one file: the ESLint node of the event.
// usage: node where.cjs <file> [--context n]
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { replayAll } = require("./replay.cjs");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const file = process.argv[2];
const ctx = Number(process.argv.includes("--context") ? process.argv[process.argv.indexOf("--context") + 1] : 4);
const code = fs.readFileSync(file, "utf8");
const ts = /\.tsx?$/u.test(file);
const events = [];
const at = node => (node ? `${node.type}@${node.loc.start.line}:${node.loc.start.column + 1}` : "-");
const rule = {
	create() {
		return {
			onCodePathStart(codePath, node) { events.push([`onCodePathStart ${codePath.id} ${codePath.origin}`, at(node)]); },
			onCodePathEnd(codePath, node) { events.push([`onCodePathEnd ${codePath.id}`, at(node)]); },
			onCodePathSegmentStart(s, node) { events.push([`onCodePathSegmentStart ${s.id}`, at(node)]); },
			onCodePathSegmentEnd(s, node) { events.push([`onCodePathSegmentEnd ${s.id}`, at(node)]); },
			onUnreachableCodePathSegmentStart(s, node) { events.push([`onUnreachableCodePathSegmentStart ${s.id}`, at(node)]); },
			onUnreachableCodePathSegmentEnd(s, node) { events.push([`onUnreachableCodePathSegmentEnd ${s.id}`, at(node)]); },
			onCodePathSegmentLoop(a, b, node) { events.push([`onCodePathSegmentLoop ${a.id} ${b.id}`, at(node)]); },
		};
	},
};
const lo = ts
	? { parser: require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser"), parserOptions: { ecmaFeatures: { jsx: /x$/u.test(file) } } }
	: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } };
const messages = new Linter().verify(code, { plugins: { t: { rules: { r: rule } } }, rules: { "t/r": 2 }, languageOptions: lo });
if (messages.some(m => m.fatal)) console.log("eslint:", messages.find(m => m.fatal).message);
const run = spawnSync("/tmp/cpa-1b/cpaprobe", [file], { env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1" }, encoding: "utf8", maxBuffer: 1 << 30 });
const bun = [...replayAll(run.stdout).values()][0];
if (bun.error) { console.log(bun.error); process.exit(1); }
let i = 0;
while (i < events.length && i < bun.events.length && events[i][0] === bun.events[i]) i++;
if (i === events.length && i === bun.events.length) { console.log("the same:", i, "events"); process.exit(0); }
for (let k = Math.max(0, i - ctx); k < Math.min(Math.max(events.length, bun.events.length), i + ctx + 1); k++) {
	console.log(`${k === i ? ">>" : "  "} ${k}: eslint ${events[k] ? events[k].join("  ") : "-"}  |  bun ${bun.events[k] || "-"}`);
}
