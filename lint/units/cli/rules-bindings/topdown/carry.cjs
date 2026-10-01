const path = require("path");
const { execFileSync } = require("child_process");
const T = "/workspace/notes/lint/units/cli/ts-entry-codes-harness/topdown/tools";
const { carry } = require(path.join(T, "eslint-side.cjs"));
for (const rule of process.argv.slice(2)) {
	const out = JSON.parse(execFileSync(process.execPath, [path.join(T, "extract.cjs"), rule], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }));
	const by = {}; const lost = [];
	for (const c of out.cases) {
		const r = carry(c.code, c.ext, c.sourceType || "module", rule);
		const k = r.ext || "none";
		by[k] = (by[k] || 0) + 1;
		if (!r.ext) lost.push(`${c.kind} ${JSON.stringify(c.code)} :: ${r.reason}`);
	}
	console.log(rule, JSON.stringify(by));
	if (process.env.SHOW) for (const l of lost) console.log("   ", l);
}
