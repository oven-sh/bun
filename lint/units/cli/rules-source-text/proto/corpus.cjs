// Research scratch: real files as cases. Prints one JSON line per file for the answers format of eslint.cjs ({ code, type, reports: [] }).
// usage: node corpus.cjs <dir>... [--max n]
"use strict";
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
let max = 3000;
const dirs = [];
while (args.length) { const a = args.shift(); if (a === "--max") max = Number(args.shift()); else dirs.push(a); }
let n = 0;
function walk(dir) {
	if (n >= max) return;
	let entries;
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
	for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
		if (n >= max) return;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) { if (e.name !== ".git") walk(p); continue; }
		const m = /\.(js|cjs|mjs|jsx|ts|tsx|mts|cts)$/.exec(e.name);
		if (!m || /\.d\.[cm]?ts$/.test(e.name)) continue;
		let code;
		try { code = fs.readFileSync(p, "utf8"); } catch { continue; }
		if (code.length > 400000) continue;
		const ext = m[1];
		const type = ext === "ts" || ext === "mts" || ext === "cts" ? "ts" : ext === "tsx" ? "tsx" : ext === "mjs" || /^\s*(import|export)\s/m.test(code) ? "module" : "script";
		console.log(JSON.stringify({ code, type, jsx: ext === "jsx" || undefined, file: p, reports: [] }));
		n++;
	}
}
for (const d of dirs) walk(d);
