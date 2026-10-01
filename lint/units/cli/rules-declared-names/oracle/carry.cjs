// Research scratch of "rules-declared-names": ESLint's own cases of a rule (default options) by the extension that carries them,
// with the table of globals of a lint run in the oracle (eslint-side.cjs of this directory).
// usage: [SHOW=1] node carry.cjs <rule>...
const path = require("path");
const { execFileSync } = require("child_process");
const { carry } = require(path.join(__dirname, "eslint-side.cjs"));
for (const rule of process.argv.slice(2)) {
	const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "extract-d2.cjs"), rule], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }));
	const by = {}; const lost = [];
	for (const c of out.cases) {
		const r = carry(c.code, c.ext, c.sourceType || "module", rule);
		const k = r.ext || "none";
		by[k] = (by[k] || 0) + 1;
		if (!r.ext) lost.push(`${c.kind} ${JSON.stringify(c.code)} :: ${r.reason}`);
	}
	console.log(rule, out.cases.length, JSON.stringify(by), "skipped", JSON.stringify(out.skipped));
	if (process.env.SHOW) for (const l of lost) console.log("   ", l);
}
