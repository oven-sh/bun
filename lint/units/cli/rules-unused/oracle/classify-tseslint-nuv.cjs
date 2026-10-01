// Research scratch of "rules-unused": the cases of typescript-eslint's own tests of no-unused-vars under the configuration of a lint run.
// usage: node classify-tseslint-nuv.cjs <cases/tseslint-*.json>... [--out list.json]
// Per case: whether its options are the defaults, the extension that carries it, what the rule answers as a lint run is
// configured (eslint-side.cjs), and whether that is what the test itself expects. --out writes the carried cases as
// [{ code, ext, expect: [{line, column, message}], own: "same" | "differs" }].
"use strict";
const fs = require("fs");
const side = require("../../ts-entry-codes-harness/topdown/tools/eslint-side.cjs");
const args = process.argv.slice(2);
let out = null;
const files = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--out") out = args[++i]; else files.push(args[i]);
const DEFAULTS = { vars: "all", args: "after-used", caughtErrors: "all", ignoreRestSiblings: false, ignoreClassWithStaticInitBlock: false, ignoreUsingDeclarations: false, reportUsedIgnorePattern: false };
const isDefault = options => {
	if (!options || options.length === 0) return true;
	const [o] = options;
	if (typeof o === "string") return o === "all";
	return Object.keys(o).every(k => k in DEFAULTS && DEFAULTS[k] === o[k]);
};
const count = { cases: 0, otherOptions: 0, carried: 0, fatal: 0, sameAsTest: 0, differsFromTest: 0, reports: 0 };
const why = {};
const list = [];
const seen = new Set();
for (const file of files) {
	const j = JSON.parse(fs.readFileSync(file, "utf8"));
	for (const kind of ["valid", "invalid"]) {
		for (const c of j[kind]) {
			count.cases++;
			if (!isDefault(c.options)) { count.otherOptions++; continue; }
			const po = (c.languageOptions && c.languageOptions.parserOptions) || {};
			const jsx = !!(po.ecmaFeatures && po.ecmaFeatures.jsx);
			const ext = c.filename && /\.d\.ts$/.test(c.filename) ? "d.ts" : jsx ? "tsx" : "ts";
			const key = ext + ":" + c.code;
			if (seen.has(key)) continue;
			seen.add(key);
			const r = side.verify(c.code, ext, ["no-unused-vars"], { plugin: true });
			if (r.fatal) { count.fatal++; why[`fatal: ${r.fatal.message.slice(0, 60)}`] = (why[`fatal: ${r.fatal.message.slice(0, 60)}`] || 0) + 1; continue; }
			count.carried++;
			count.reports += r.messages.length;
			const got = r.messages.map(m => `${m.line}:${m.column}`).sort();
			const want = (kind === "invalid" ? c.errors : []).map(e => `${e.line}:${e.column}`).sort();
			const wantKnown = want.every(w => !w.includes("undefined"));
			const same = wantKnown ? JSON.stringify(got) === JSON.stringify(want) : got.length === want.length;
			if (same) count.sameAsTest++;
			else {
				count.differsFromTest++;
				const special = Object.keys(po).filter(k => !["ecmaVersion", "sourceType", "ecmaFeatures"].includes(k)).join(",") || (c.languageOptions.parserOptions && c.languageOptions.parserOptions.sourceType === "script" ? "script" : "plain");
				why[`differs (${special})`] = (why[`differs (${special})`] || 0) + 1;
				if (process.env.SHOW) console.log(`DIFFERS [${ext}] ${JSON.stringify(c.code).slice(0, 300)}\n   test: ${want.join(" ")}\n   run:  ${r.messages.map(m => `${m.line}:${m.column} ${m.message}`).join(" | ")}\n   parserOptions: ${JSON.stringify(po)}`);
			}
			list.push({ code: c.code, ext, expect: r.messages.map(m => ({ line: m.line, column: m.column, message: m.message })), own: same ? "same" : "differs" });
		}
	}
}
console.log(JSON.stringify(count), JSON.stringify(why));
if (out) fs.writeFileSync(out, JSON.stringify(list, null, "\t") + "\n");
