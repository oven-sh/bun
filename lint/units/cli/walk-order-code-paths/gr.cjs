// Research scratch: what ESLint at the pin reports for getter-return (default options) on a source.
// usage: node gr.cjs [--ext ts|tsx|js|jsx] -e "src" ...      prints line:col-endLine:endCol message
"use strict";
const { verify } = require("../round2-oracle/proto-1b/eslint-side.cjs");
const args = process.argv.slice(2);
let ext = "js";
const sources = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--ext") ext = args[++i];
	else if (args[i] === "-e") sources.push([ext, args[++i]]);
}
for (const [e, code] of sources) {
	const r = verify(code, e, ["getter-return"]);
	const out = r.fatal ? `FATAL ${r.fatal.message}` : r.messages.map(m => `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.message}`).join(" | ");
	console.log(`[${r.ext}] ${JSON.stringify(code)}\n    => ${out || "(none)"}`);
}
