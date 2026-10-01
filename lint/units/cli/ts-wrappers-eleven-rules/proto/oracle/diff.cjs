// Differential check of one rule: `bun --lint` of the debug build against ESLint at the pin, case by case.
// usage: node diff.cjs <rule> [--show] [--out vectors.json] <cases.json|cases.txt>...
// cases: see readCases of common.cjs. A case that is given twice (same extension and text) is run once.
// The vectors that --out writes: { code, ext?, jsx?, sourceType, eslint: [{line, column, endLine, endColumn, message}] | null,
//   expect: [{line, column, message}] | null, differs?, eslintTest? }. eslint null: ESLint's parser rejects. expect null: Bun's rejects.
"use strict";
const fs = require("fs");
const { verifyCase, bunLint, isSyntaxError, flat, readCases, keyOf, extOf } = require("./common.cjs");

const args = process.argv.slice(2);
const rule = args.shift();
let show = false;
let out = null;
const files = [];
while (args.length) {
	const a = args.shift();
	if (a === "--show") show = true;
	else if (a === "--out") out = args.shift();
	else files.push(a);
}

const cases = [];
const seen = new Map();
for (const f of files)
	for (const c of readCases(f)) {
		const one = { code: c.code };
		if (c.ext) one.ext = c.ext;
		else if (c.jsx) one.jsx = true;
		if (c.sourceType && !c.ext) one.sourceType = c.sourceType;
		const key = keyOf(one) + (one.sourceType || "");
		const earlier = seen.get(key);
		if (earlier) {
			if (c.eslintTest) earlier.eslintTest = true;
			continue;
		}
		if (c.eslintTest) one.eslintTest = true;
		seen.set(key, one);
		cases.push(one);
	}

(async () => {
	// ESLint first: it settles whether a JavaScript case is read with JSX, which is the extension of its file.
	const theirs = cases.map(c => verifyCase(c, [rule]));
	const ours = await bunLint(cases);
	const tally = { same: 0, merged: 0, moved: 0, missing: 0, "other-text": 0, extra: 0, "bun-rejects": 0, "eslint-rejects": 0, "both-reject": 0 };
	const vectors = [];
	const details = [];
	cases.forEach((c, i) => {
		const e = theirs[i];
		const lines = ours[i];
		const rejected = lines.some(isSyntaxError);
		const mine = lines.filter(l => l.code === rule || l.code === "internal-error");
		const key = m => `${m.line}:${m.column} ${flat(m.message)}`;
		let kind;
		if (rejected && e.fatal) kind = "both-reject";
		else if (rejected) kind = "bun-rejects";
		else if (e.fatal) kind = "eslint-rejects";
		else {
			const a = e.reports.map(key).sort();
			const b = mine.map(key).sort();
			const aSet = [...new Set(a)];
			const bSet = [...new Set(b)];
			if (JSON.stringify(a) === JSON.stringify(b)) kind = "same";
			// `bun --lint` says an equal diagnostic once.
			else if (JSON.stringify(aSet) === JSON.stringify(bSet)) kind = "merged";
			else {
				const texts = l => l.map(k => k.slice(k.indexOf(" ") + 1)).sort();
				if (JSON.stringify(texts(aSet)) === JSON.stringify(texts(bSet))) kind = "moved";
				else if (bSet.every(k => aSet.includes(k))) kind = "missing";
				else if (bSet.length === aSet.length) kind = "other-text";
				else kind = "extra";
			}
		}
		tally[kind] += 1;
		if (kind !== "same" && kind !== "merged" && kind !== "both-reject")
			details.push(
				`${kind}: ${JSON.stringify(c.code)} [${extOf(c)}] [${c.type}]\n    eslint: ${
					e.fatal ? "FATAL " + e.fatal.message : e.reports.map(key).join(" | ") || "(none)"
				}\n    bun:    ${rejected ? "REJECTS " + lines.filter(isSyntaxError).map(l => `${l.code} ${l.message}`).join(" | ") : mine.map(key).join(" | ") || "(none)"}`,
			);
		const v = { code: c.code };
		if (c.ext) v.ext = c.ext;
		else if (c.jsx) v.jsx = true;
		v.sourceType = c.type;
		v.eslint = e.fatal ? null : e.reports.map(({ rule: _, ...rest }) => rest);
		// Where the answers are one, the text is ESLint's: it has the line break that the plain format writes as a space.
		if (rejected) v.expect = null;
		else if (kind === "same" || kind === "merged") {
			const order = (x, y) => x.line - y.line || x.column - y.column || (x.message < y.message ? -1 : x.message > y.message ? 1 : 0);
			const sorted = e.reports.map(m => ({ line: m.line, column: m.column, message: m.message })).sort(order);
			v.expect = sorted.filter((m, j) => j === 0 || order(sorted[j - 1], m) !== 0);
		} else v.expect = mine.map(l => (l.code === rule ? { line: l.line, column: l.column, message: l.message } : { line: l.line, column: l.column, message: l.message, code: l.code }));
		if (kind !== "same" && kind !== "merged") v.differs = kind;
		if (c.eslintTest) v.eslintTest = true;
		vectors.push(v);
	});
	console.log(`${rule}: ${cases.length} cases: ` + Object.entries(tally).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", "));
	if (show) for (const d of details) console.log(d);
	if (out) fs.writeFileSync(out, JSON.stringify(vectors, null, "\t") + "\n");
})().catch(err => {
	console.error(String(err && err.stack ? err.stack : err));
	process.exit(1);
});
