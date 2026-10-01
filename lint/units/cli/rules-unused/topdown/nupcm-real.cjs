// Research scratch of "rules-unused" (pass 1b): no-unused-private-class-members of a BINARY on Bun's tree against
// ESLint's rule at the pin. The binary is the probe of the other pass (../probe, `nupcm <file>...`: `== <path>`, then
// one `<line>:<column> <message>` per report or PARSE_ERROR), or any program with that output.
// usage: node nupcm-real.cjs --probe /tmp/ru/nupcm [--show N] [--ext e] <file | cases.json | --list files.txt>...
//   a .json is ["code"] or [{code, ext}] or {valid, invalid}. JavaScript: espree; TypeScript: typescript-eslint's parser.
//   `extra`: a report of the binary that ESLint does not make. `missing`: the other way.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const req = require("module").createRequire("/workspace/ref/tseslint/");
const tsParser = req("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
function eslint(code, ext) {
	const isTs = /^(d\.)?[cm]?tsx?$/.test(ext);
	const tries = isTs ? [[ext === "cts" ? "commonjs" : "module", false]] : ext === "mjs" ? [["module", false]] : ext === "cjs" ? [["commonjs", false]] : ext === "jsx" ? [["script", true], ["module", true]] : [["script", false], ["module", false], ["script", true], ["module", true]];
	for (const [sourceType, jsx] of tries) {
		const languageOptions = isTs ? { parser: tsParser, ecmaVersion: "latest", sourceType } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
		const config = [{ files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], languageOptions, linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" }, rules: { "no-unused-private-class-members": "error" } }];
		const messages = linter.verify(code, config, { filename: `c.${ext}` });
		if (messages.some(m => m.fatal)) continue;
		return messages.map(m => `${m.line}:${m.column} ${m.message}`).sort();
	}
	return null;
}
const args = process.argv.slice(2);
let probe = process.env.NUPCM || "/tmp/ru/nupcm", show = 20, forceExt = null;
const inputs = [];
const push = c => inputs.push(typeof c === "string" ? { code: c } : { code: c.code, ext: c.ext });
while (args.length) {
	const a = args.shift();
	if (a === "--probe") probe = args.shift();
	else if (a === "--show") show = Number(args.shift());
	else if (a === "--ext") forceExt = args.shift();
	else if (a === "--list") for (const f of fs.readFileSync(args.shift(), "utf8").split("\n").filter(Boolean)) inputs.push({ file: f });
	else if (a.endsWith(".json")) { const j = JSON.parse(fs.readFileSync(a, "utf8")); if (Array.isArray(j)) j.forEach(push); else for (const k of ["valid", "invalid"]) (j[k] || []).forEach(push); }
	else inputs.push({ file: a });
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nupcm-real-"));
const work = [];
inputs.forEach((input, i) => {
	let code = input.code, ext = forceExt || input.ext || "js";
	if (input.file) {
		try { code = fs.readFileSync(input.file, "utf8"); } catch { return; }
		const m = /\.(d\.ts|d\.mts|d\.cts|tsx|mts|cts|ts|jsx|mjs|cjs|js)$/.exec(input.file);
		if (!m) return;
		ext = forceExt || m[1];
	}
	const file = path.join(dir, `c${String(i).padStart(6, "0")}.${ext}`);
	fs.writeFileSync(file, code);
	work.push({ file, code: code.replace(/^\uFEFF/, ""), ext, from: input.file });
});
const ours = new Map();
for (let i = 0; i < work.length; i += 200) {
	const batch = work.slice(i, i + 200).map(w => w.file);
	let out = "";
	try { out = execFileSync(probe, batch, { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" } }); } catch (e) { out = String(e.stdout || ""); }
	let current = null;
	for (const line of out.split("\n")) {
		if (line.startsWith("== ")) { current = line.slice(3); ours.set(current, []); }
		else if (line && current) ours.get(current).push(line);
	}
}
const tally = { inputs: work.length, same: 0, different: 0, bothReject: 0, onlyEslintRejects: 0, onlyBunRejects: 0, noAnswer: 0, reports: 0, extra: 0, missing: 0 };
let shown = 0;
for (const w of work) {
	const theirs = eslint(w.code, w.ext);
	const got = ours.get(w.file);
	if (!got) { tally.noAnswer += 1; continue; }
	const rejected = got.includes("PARSE_ERROR") || got.includes("CANNOT_READ_OR_INIT");
	if (theirs === null) { if (rejected) tally.bothReject += 1; else tally.onlyEslintRejects += 1; continue; }
	if (rejected) { tally.onlyBunRejects += 1; if (shown++ < show) console.log(`ONLY BUN REJECTS ${w.from || JSON.stringify(w.code).slice(0, 300)} [${w.ext}]`); continue; }
	const mine = got.filter(l => /^\d+:\d+ /.test(l)).sort();
	tally.reports += theirs.length;
	if (JSON.stringify(mine) === JSON.stringify(theirs)) { tally.same += 1; continue; }
	tally.different += 1;
	const extra = mine.filter(x => !theirs.includes(x)), missing = theirs.filter(x => !mine.includes(x));
	tally.extra += extra.length;
	tally.missing += missing.length;
	if (shown++ < show) console.log(`DIFFERENT ${w.from || JSON.stringify(w.code).slice(0, 400)} [${w.ext}]\n  only eslint: ${missing.slice(0, 8).join(" | ") || "-"}\n  only bun:    ${extra.slice(0, 8).join(" | ") || "-"}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(tally));
