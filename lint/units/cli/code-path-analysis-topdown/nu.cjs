// Research scratch: what ESLint's no-unreachable at the pin reports for a source: `line:col` of every report.
// usage: node nu.cjs [--ts] <<< "source"   or   node nu.cjs [--ts] -e "src1" -e "src2" ...
"use strict";
const path = require("path");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const linter = new Linter();
const args = process.argv.slice(2);
const ts = args.includes("--ts");
const sources = [];
for (let i = 0; i < args.length; i++) if (args[i] === "-e") sources.push(args[++i]);
if (!sources.length) sources.push(require("fs").readFileSync(0, "utf8"));
const parser = ts ? require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser") : null;
for (const code of sources) {
	let out = null;
	for (const sourceType of ts ? ["module"] : ["module", "commonjs", "script"]) {
		const lo = ts ? { parser } : { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx: true } } };
		const messages = linter.verify(code, { rules: { "no-unreachable": 2 }, languageOptions: lo });
		out = messages.map(m => (m.fatal ? `FATAL ${m.message}` : `${m.line}:${m.column}-${m.endLine}:${m.endColumn}`)).join(" ");
		if (!messages.some(m => m.fatal)) break;
	}
	console.log(`${JSON.stringify(code)}\n    => ${out || "(none)"}`);
}
