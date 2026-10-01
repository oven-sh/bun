// Scratch oracle: runs the four rules of eslint@10.11.0 (rule files byte-identical to pin 4618052) with defaults.
// usage: node probe.cjs <rule|all> <module|script|commonjs> <file-with-cases>   (cases separated by a line "----")
const { Linter } = require("eslint");
const fs = require("fs");
const [ruleArg, sourceType, file] = process.argv.slice(2);
const all = ["no-compare-neg-zero", "use-isnan", "valid-typeof", "no-unsafe-negation"];
const rules = {};
for (const r of ruleArg === "all" ? all : ruleArg.split(",")) rules[r] = "error";
const linter = new Linter();
const text = fs.readFileSync(file, "utf8");
const cases = text.split(/^----\n/m);
for (const raw of cases) {
	const code = raw.replace(/\n$/, "");
	if (code === "") continue;
	const msgs = linter.verify(
		code,
		[
			{
				languageOptions: {
					ecmaVersion: "latest",
					sourceType,
					parserOptions: { ecmaFeatures: { jsx: true } },
				},
				rules,
			},
		],
		{ filename: "x.js" },
	);
	console.log("CODE " + JSON.stringify(code));
	if (msgs.length === 0) console.log("   (none)");
	for (const m of msgs) {
		console.log(
			`   ${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.ruleId ?? "FATAL"}: ${m.message}`,
		);
	}
}
