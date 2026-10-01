// Research scratch: ESLint at the pin with the parser of typescript-eslint over a list of TypeScript cases.
// usage: node ts.cjs <rule[,rule]> <cases.json | code...>
//   cases.json: a JSON array of { code, ext } (ext ts or tsx, as the lists of round2-oracle/proto-1b) or of strings (a .ts file).
//   Prints the code and "line:column message" of each report ("rule line:column message" when more than one rule is named).
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const parser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const rules = process.argv[2].split(",");
let cases = process.argv.slice(3);
if (cases.length === 1 && cases[0].endsWith(".json")) cases = JSON.parse(require("fs").readFileSync(cases[0], "utf8"));
for (const raw of cases) {
	const c = typeof raw === "string" ? { code: raw, ext: "ts" } : raw;
	const tsx = c.ext === "tsx";
	const messages = linter.verify(c.code, [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: tsx } }, sourceType: "module" }, rules: Object.fromEntries(rules.map(r => [r, "error"])) }], { filename: `a.${c.ext}` });
	const line = m => (m.fatal ? "FATAL " : "") + `${rules.length > 1 && m.ruleId ? m.ruleId + " " : ""}${m.line}:${m.column} ${m.message}`;
	console.log(`${JSON.stringify(c.code)}${tsx ? " [tsx]" : ""}\n      => ${messages.map(line).join(" | ") || "(none)"}`);
}
