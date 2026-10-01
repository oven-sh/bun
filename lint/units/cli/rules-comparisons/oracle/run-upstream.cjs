// Scratch: run the default-option upstream cases through the oracle and print one line per case.
const { Linter } = require("eslint");
const rule = process.argv[2];
const o = require(`../cases/upstream-${rule}.json`);
const linter = new Linter();
function run(t) {
	const lo = Object.assign({ ecmaVersion: "latest", sourceType: "module" }, t.languageOptions || {});
	if (lo.ecmaVersion && lo.ecmaVersion < 2015 && lo.sourceType === "module") lo.sourceType = "script";
	lo.parserOptions = Object.assign({ ecmaFeatures: { jsx: true } }, lo.parserOptions || {});
	return linter.verify(t.code, [{ languageOptions: lo, rules: { [rule]: "error" } }], { filename: "x.js" });
}
for (const kind of ["valid", "invalid"]) {
	console.log(`## ${kind}`);
	for (const t of o[kind]) {
		const msgs = run(t);
		const lo = t.languageOptions ? " " + JSON.stringify(t.languageOptions) : "";
		console.log(JSON.stringify(t.code) + lo + " => " + (msgs.length === 0 ? "none" : msgs.map(m => `${m.line}:${m.column} ${m.fatal ? "FATAL " : ""}${m.message}`).join(" | ")));
	}
}
