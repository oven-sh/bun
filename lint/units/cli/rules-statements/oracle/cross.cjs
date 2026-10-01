// Research scratch: which cases of the existing fixtures make one of the twelve new rules report (ESLint at the pin).
"use strict";
const path = require("path"); const fs = require("fs");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const mine=["for-direction","no-async-promise-executor","no-case-declarations","no-delete-var","no-prototype-builtins","no-setter-return","no-unsafe-finally","no-unused-labels","no-useless-catch","no-with","require-yield","no-unused-private-class-members"];
const rules = Object.fromEntries(mine.map(r => [r, "error"]));
const dir = "/workspace/wt/cli/test/cli/lint/rules";
const tally = {}; const samples = {};
let total = 0, fatal = 0;
for (const f of fs.readdirSync(dir).sort()) {
	const cases = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
	for (const c of cases) {
		total++;
		let messages;
		for (const [t, jsx] of [["script", !!c.jsx], ["module", !!c.jsx], ["script", true], ["module", true]]) {
			messages = linter.verify(c.code, [{ languageOptions: { ecmaVersion: "latest", sourceType: t, parserOptions: { ecmaFeatures: { jsx } } }, rules }]);
			if (!messages.some(m => m.fatal)) break;
		}
		if (messages.some(m => m.fatal)) { fatal++; continue; }
		for (const id of new Set(messages.map(m => m.ruleId))) {
			const k = `${id} <- ${f.replace(".json", "")}`;
			tally[k] = (tally[k] || 0) + 1;
			(samples[id] = samples[id] || []).length < 4 && samples[id].push(JSON.stringify(c.code).slice(0, 110) + "  => " + messages.filter(m => m.ruleId === id).map(m => `${m.line}:${m.column}`).join(","));
		}
	}
}
console.log("cases", total, "eslint-fatal", fatal);
const byRule = {};
for (const [k, n] of Object.entries(tally)) { const [id, from] = k.split(" <- "); (byRule[id] = byRule[id] || []).push(`${from}=${n}`); }
for (const id of mine) console.log(id + ": " + (byRule[id] ? byRule[id].join(" ") : "(none)") + (samples[id] ? "\n    " + samples[id].join("\n    ") : ""));
