// DRAFT (see eslint-side.cjs). One command per rule: writes test/cli/lint/rules/<rule>.json again.
// usage: node regen.cjs <rule> [--tree /workspace/wt/cli] [--bun path] [--cases dir] [--only-fixture] [--answer core|plugin] [--write] [--show]
// The cases, in this order, each once: the fixture of the tree as it is, ESLint's own test of the rule (extract.cjs,
// TypeScript cases included), and every <cases dir>/*-<rule>.json (default: cases/ beside this file). `expect` is what
// `bun --lint` printed; where ESLint's answer for that file is another, the case gets `differs` and `eslint`. A case that
// either parser rejects is left out. `ext` is written for every extension but js and jsx (`jsx: true`, as round 1 wrote it).
// Without --write the result goes to out/<rule>.json and the tree is not touched. It always says how the result differs from the tree.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { diff, read, order } = require("./diff.cjs");
const args = process.argv.slice(2);
const rule = args.shift();
let tree = "/workspace/wt/cli", bun, onlyFixture = false, write = false, show = false, answer, own = path.join(__dirname, "cases");
while (args.length) {
	const a = args.shift();
	if (a === "--tree") tree = args.shift();
	else if (a === "--bun") bun = args.shift();
	else if (a === "--cases") own = args.shift();
	else if (a === "--only-fixture") onlyFixture = true;
	else if (a === "--answer") answer = args.shift();
	else if (a === "--write") write = true;
	else if (a === "--show") show = true;
}
const fixturePath = path.join(tree, "test/cli/lint/rules", `${rule}.json`);
const sources = [];
if (fs.existsSync(fixturePath)) sources.push(fixturePath);
const tmp = path.join(require("os").tmpdir(), `lint-extract-${rule}-${process.pid}.json`);
const every = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "extract.cjs"), rule, "--all"], { encoding: "utf8", maxBuffer: 1 << 28 }));
if (!onlyFixture) {
	fs.writeFileSync(tmp, execFileSync(process.execPath, [path.join(__dirname, "extract.cjs"), rule], { encoding: "utf8", maxBuffer: 1 << 28 }));
	sources.push(tmp);
	if (fs.existsSync(own)) for (const f of fs.readdirSync(own).sort()) if (f.endsWith(`-${rule}.json`)) sources.push(path.join(own, f));
}
// By the text alone, as round 1 marked it: a case of the TypeScript run of ESLint's test that is also JavaScript is marked in both files.
const eslintTest = new Set(every.map(c => c.code));
diff(rule, read(sources), { bun: bun || path.join(tree, "build/debug/bun-debug"), answer }).then(({ tally, vectors, details }) => {
	fs.rmSync(tmp, { force: true });
	const out = [];
	for (const v of vectors) {
		if (v.expect === null || v.eslint === null) continue;
		const c = { code: v.code };
		if (v.ext === "jsx") c.jsx = true;
		else if (v.ext !== "js") c.ext = v.ext;
		const once = list => list.slice().sort(order).filter((m, i, l) => i === 0 || order(l[i - 1], m) !== 0);
		c.expect = once(v.expect);
		if (v.differs) {
			c.differs = v.differs;
			c.eslint = v.eslint.slice().sort(order);
		}
		if (eslintTest.has(v.code)) c.eslintTest = true;
		out.push(c);
	}
	// Only ASCII in the file: a character that an editor does not show is written as its escape.
	const ascii = line => line.replace(/[\u007f-\uffff]/g, ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
	const text = "[\n" + out.map(c => "\t" + ascii(JSON.stringify(c))).join(",\n") + "\n]\n";
	console.log(`${rule}: ${vectors.length} cases: ` + Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", ") + `; fixture: ${out.length} cases, ${out.filter(c => c.ext).length} with ext, ${out.filter(c => c.differs).length} that differ from ESLint`);
	if (show) for (const d of details) console.log(d);
	const before = fs.existsSync(fixturePath) ? fs.readFileSync(fixturePath, "utf8") : "";
	if (before === text) console.log("  the fixture of the tree is the same bytes");
	else if (before && JSON.stringify(JSON.parse(before)) === JSON.stringify(out)) console.log("  the fixture of the tree holds the same cases: only the escapes of its text differ");
	else {
		const old = before ? JSON.parse(before) : [];
		const k = c => `${c.ext || (c.jsx ? "jsx" : "js")}:${c.code}`;
		const oldBy = new Map(old.map(c => [k(c), JSON.stringify(c)]));
		const newBy = new Map(out.map(c => [k(c), JSON.stringify(c)]));
		const newCodes = new Map(out.map(c => [c.code, c]));
		let added = 0, removed = 0, changed = 0, moved = 0;
		for (const [key, line] of newBy) if (!oldBy.has(key)) added += 1; else if (oldBy.get(key) !== line) { changed += 1; if (show || changed <= 10) console.log(`  changed: ${oldBy.get(key)}\n       to: ${line}`); }
		for (const [key, line] of oldBy) if (!newBy.has(key)) {
			const c = JSON.parse(line);
			// The same text under another extension: the case moved to the extension whose source type parses it.
			const now = newCodes.get(c.code);
			if (now && JSON.stringify(now.expect) === JSON.stringify(c.expect)) { moved += 1; if (show || moved <= 3) console.log(`  moved to .${now.ext || (now.jsx ? "jsx" : "js")}: ${JSON.stringify(c.code)}`); }
			else { removed += 1; if (show || removed <= 10) console.log(`  removed: ${line}`); }
		}
		console.log(`  against the tree: ${added - moved} added, ${moved} moved to another extension, ${removed} removed, ${changed} changed`);
	}
	const target = write ? fixturePath : path.join(__dirname, "out", `${rule}.json`);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, text);
	console.log(`  wrote ${target}`);
}, e => {
	console.error(String(e && e.stack || e));
	process.exit(1);
});
