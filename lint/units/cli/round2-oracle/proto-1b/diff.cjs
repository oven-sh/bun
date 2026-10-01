// PROTOTYPE of research pass 1b. ESLint at the pin against `bun --lint` for one rule and lists of cases.
// usage: node diff.cjs <rule> [--show] [--out vectors.json] [--bun path] <cases.json>...
// cases: a JSON array of strings or of { code, ext?, jsx?, sourceType? } (a fixture of the tree is such a list), or the
// output of extract.cjs ({ cases: [...] }). A string is a `.js` file. exports diff(rule, cases, options) for regen.cjs.
"use strict";
const fs = require("fs");
const { verify } = require("./eslint-side.cjs");
const { lint } = require("./bun-side.cjs");

function read(files) {
	const cases = [];
	const seen = new Set();
	for (const f of files) {
		const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
		const list = Array.isArray(parsed) ? parsed : parsed.cases;
		for (const raw of list) {
			const c = typeof raw === "string" ? { code: raw } : raw;
			if (typeof c.code !== "string") continue;
			const ext = c.ext || (c.jsx ? "jsx" : "js");
			const key = `${ext}:${c.sourceType || ""}:${c.code}`;
			if (seen.has(key)) continue;
			seen.add(key);
			cases.push({ code: c.code, ext, sourceType: c.sourceType });
		}
	}
	return cases;
}

// The plain format writes a line break inside a message as one space.
const flat = text => text.replace(/\r\n?|\n/g, " ");
const order = (a, b) => a.line - b.line || a.column - b.column || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0);

async function diff(rule, cases, options = {}) {
	for (const c of cases) {
		const r = verify(c.code, c.ext, [rule], c.sourceType);
		// A `.js` case that only parses with JSX is a `.jsx` file.
		c.ext = r.ext;
		c.type = r.sourceType;
		c.fatal = r.fatal;
		c.eslint = r.messages.map(m => ({ line: m.line, column: m.column, message: m.message })).sort(order);
	}
	const files = cases.map((c, i) => ({ name: `c${String(i).padStart(5, "0")}.${c.ext}`, code: c.code }));
	const bun = await lint(files, options);
	const tally = {};
	const vectors = [];
	const details = [];
	cases.forEach((c, i) => {
		const mine = bun.get(files[i].name);
		// A message of ESLint with a line break in it is printed with a space there: the fixture keeps the text of ESLint.
		const unflat = r => (c.eslint.find(m => m.line === r.line && m.column === r.column && flat(m.message) === r.message) || r).message;
		const reports = mine.reports.filter(r => r.code === rule).map(r => ({ line: r.line, column: r.column, message: unflat(r) })).sort(order);
		let kind;
		if (mine.rejected && c.fatal) kind = "both-reject";
		else if (mine.rejected) kind = "bun-rejects";
		else if (c.fatal) kind = "eslint-rejects";
		else {
			const key = m => `${m.line}:${m.column} ${m.message}`;
			// `bun --lint` says an equal diagnostic once.
			const theirs = [...new Set(c.eslint.map(key))];
			const ours = [...new Set(reports.map(key))];
			const texts = l => l.map(k => k.slice(k.indexOf(" ") + 1)).sort();
			if (JSON.stringify(theirs) === JSON.stringify(ours)) kind = "same";
			else if (JSON.stringify(texts(theirs)) === JSON.stringify(texts(ours))) kind = "moved";
			else if (ours.every(k => theirs.includes(k))) kind = "missing";
			else if (ours.length === theirs.length) kind = "other-text";
			else kind = "extra";
		}
		tally[kind] = (tally[kind] || 0) + 1;
		if (kind !== "same" && kind !== "both-reject")
			details.push(`${kind}: ${JSON.stringify(c.code)} [${c.ext}] [${c.type}]\n    eslint: ${c.fatal ? "FATAL " + c.fatal.message : c.eslint.map(m => `${m.line}:${m.column} ${m.message}`).join(" | ") || "(none)"}\n    bun:    ${mine.rejected ? mine.rejected : reports.map(m => `${m.line}:${m.column} ${m.message}`).join(" | ") || "(none)"}`);
		const v = { code: c.code, ext: c.ext, sourceType: c.type, eslint: c.fatal ? null : c.eslint, expect: mine.rejected ? null : reports };
		if (kind !== "same") v.differs = kind;
		// What the other rules said about the case: the cross-rule run reads it.
		v.others = mine.reports.filter(r => r.code !== rule).map(r => `${r.line}:${r.column} ${r.code}`);
		vectors.push(v);
	});
	return { tally, vectors, details };
}

module.exports = { diff, read, order };
if (require.main === module) {
	const args = process.argv.slice(2);
	const rule = args.shift();
	let show = false, out = null, bun;
	const files = [];
	while (args.length) {
		const a = args.shift();
		if (a === "--show") show = true;
		else if (a === "--out") out = args.shift();
		else if (a === "--bun") bun = args.shift();
		else files.push(a);
	}
	diff(rule, read(files), { bun }).then(({ tally, vectors, details }) => {
		console.log(`${rule}: ${vectors.length} cases: ` + Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(", "));
		if (show) for (const d of details) console.log(d);
		if (out) fs.writeFileSync(out, JSON.stringify(vectors, null, "\t") + "\n");
	}, e => {
		console.error(String(e && e.stack || e));
		process.exit(1);
	});
}
