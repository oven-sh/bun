// Scratch: the case lists in the compact form used in the findings.
const { mine, theirs } = require("./lists.cjs");
const fs = require("fs");
const rule = process.argv[2];
const files = process.argv.slice(3);
const tag = m => {
	let x;
	if ((x = /^Do not use the '(.+)' operator to compare against -0\.$/.exec(m))) return `[${x[1]}]`;
	if ((x = /^Unexpected negating the left operand of '(.+)' operator\.$/.exec(m))) return `[${x[1]}]`;
	if (m === "Use the isNaN function to compare with NaN.") return "C";
	if (m.startsWith("'switch(NaN)'")) return "S";
	if (m.startsWith("'case NaN'")) return "K";
	if (m === "Invalid typeof comparison value.") return "";
	throw new Error("unknown message " + m);
};
const fmt = list => (list.length === 0 ? "none" : list.map(e => { const sp = e.indexOf(" "); return e.slice(0, sp) + tag(e.slice(sp + 1)); }).join(" "));
const seen = new Set();
const out = { valid: [], invalid: [], different: [] };
for (const f of files) for (const raw of fs.readFileSync(f, "utf8").split(/^----\n/m)) {
	const code = raw.replace(/\n$/, "");
	if (!code || seen.has(code)) continue;
	seen.add(code);
	const t = theirs(code, rule);
	if (t === null) continue;
	const m = mine(code, rule);
	if (JSON.stringify(t) !== JSON.stringify(m)) out.different.push(`${JSON.stringify(code)} => ESLint ${fmt(t)}; bun ${fmt(m)}`);
	else if (t.length === 0) out.valid.push(JSON.stringify(code));
	else out.invalid.push(`${JSON.stringify(code)} => ${fmt(t)}`);
}
console.log(`${rule}: ${out.valid.length} valid, ${out.invalid.length} invalid, ${out.different.length} different`);
console.log("VALID:\n" + out.valid.join("\n"));
console.log("INVALID:\n" + out.invalid.join("\n"));
console.log("DIFFERENT:\n" + out.different.join("\n"));
