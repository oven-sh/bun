// Research scratch: real files as a case list for drive.cjs.
// usage: node corpus.cjs <max files> <max bytes> <dir>... > list.json      files of js, jsx, mjs, cjs, ts, tsx, mts, cts, in the order of a sorted walk
"use strict";
const fs = require("fs");
const path = require("path");
const [max, maxBytes, ...dirs] = process.argv.slice(2);
const out = [];
const EXT = /\.(d\.ts|[cm]?[jt]sx?)$/;
function walk(dir) {
	if (out.length >= +max) return;
	let entries;
	try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)); } catch { return; }
	for (const e of entries) {
		if (out.length >= +max) return;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) { if (e.name !== ".git") walk(p); continue; }
		const m = EXT.exec(e.name);
		if (!m || !e.isFile()) continue;
		const st = fs.statSync(p);
		if (st.size > +maxBytes || st.size === 0) continue;
		const buf = fs.readFileSync(p);
		const code = buf.toString("utf8");
		// Only text that is the same after a round trip: a case is a file again for the probe.
		if (!Buffer.from(code, "utf8").equals(buf)) continue;
		let ext = m[1] === "d.ts" ? "ts" : m[1];
		out.push({ code, ext, file: p });
	}
}
for (const d of dirs) walk(d);
process.stdout.write(JSON.stringify(out));
