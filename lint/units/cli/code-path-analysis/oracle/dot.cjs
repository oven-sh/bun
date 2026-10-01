// ESLint at the pin: the arrows of every code path of a JavaScript text, and how many segment ids each path used.
// usage: node dot.cjs [--type module|commonjs|script] <code>...
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const debug = require("/workspace/ref/eslint/lib/linter/code-path-analysis/debug-helpers");
const linter = new Linter({ configType: "flat" });
let type = "commonjs";
const args = process.argv.slice(2);
if (args[0] === "--type") { type = args[1]; args.splice(0, 2); }
for (const code of args) {
	const out = [];
	const rule = { create: () => ({
		onCodePathEnd(codePath) {
			const used = Number(/_(\d+)$/u.exec(codePath.internal.idGenerator.next())[1]) - 1;
			out.push(`${codePath.id} ${codePath.origin} ids=${used}: ${debug.makeDotArrows(codePath).replace(/\n/gu, " ")}`);
		},
	}) };
	const messages = linter.verify(code, [{ plugins: { t: { rules: { r: rule } } }, languageOptions: { ecmaVersion: "latest", sourceType: type }, rules: { "t/r": 2 } }]);
	console.log(JSON.stringify(code));
	for (const m of messages) console.log("   MESSAGE", m.message);
	for (const o of out) console.log("   ", o);
}
