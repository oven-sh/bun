// ESLint at the pin with the parser of typescript-eslint: the code paths of a TypeScript text, as arrows, and where each starts.
// usage: node ts-dot.cjs <code>...   a code that starts with "//tsx\n" is read as a.tsx
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const debug = require("/workspace/ref/eslint/lib/linter/code-path-analysis/debug-helpers");
const parser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
for (const code of process.argv.slice(2)) {
	const tsx = code.startsWith("//tsx\n");
	const out = [];
	const rule = { create: () => ({
		onCodePathStart(codePath, node) { out.push(`start ${codePath.id} ${codePath.origin} at ${node.type}@${node.range[0]}`); },
		onCodePathEnd(codePath, node) { out.push(`end ${codePath.id}: ${debug.makeDotArrows(codePath).replace(/\n/gu, " ")}`); },
	}) };
	const messages = linter.verify(code, [{ files: ["**/*.ts", "**/*.tsx"], plugins: { t: { rules: { r: rule } } }, languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: tsx } }, sourceType: "module" }, rules: { "t/r": 2 } }], { filename: tsx ? "a.tsx" : "a.ts" });
	console.log(JSON.stringify(code));
	for (const m of messages) console.log("   MESSAGE", m.message);
	for (const o of out) console.log("   ", o);
}
