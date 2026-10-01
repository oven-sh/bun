// usage: node v.cjs <ext> <rules,comma> [--core] <cases.json>   ESLint at the pin as the harness configures it (plugin rule stands in for TS files unless --core)
const { verify, PLUGIN_RULES } = require("/workspace/notes/lint/units/cli/ts-entry-codes-harness/topdown/tools/eslint-side.cjs");
const args = process.argv.slice(2);
const core = args.includes("--core");
const [ext, rules, file] = args.filter(a => a !== "--core");
if (ext === "plugins") { console.log(PLUGIN_RULES.join(" ")); process.exit(0); }
const cases = JSON.parse(require("fs").readFileSync(file, "utf8"));
for (const code of cases) {
	const r = verify(code, ext, rules.split(","), { plugin: !core });
	console.log("== " + JSON.stringify(code) + (r.ext !== ext ? `   [as .${r.ext}]` : ""));
	if (r.fatal) console.log(`  FATAL ${r.fatal.line}:${r.fatal.column} ${r.fatal.message}`);
	for (const m of r.messages) console.log(`  ${m.ruleId} ${m.line}:${m.column} ${m.message}`);
}
