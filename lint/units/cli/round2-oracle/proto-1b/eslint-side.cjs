// PROTOTYPE of research pass 1b. ESLint at the pin, with typescript-eslint's parser for TypeScript files.
// Needs: sh /workspace/notes/lint/units/cli/tools/eslint-oracle-setup.sh (makes /workspace/ref/eslint and /workspace/ref/tseslint).
// exports { EXTS, isTs, verify(code, ext, rules, sourceType?) -> { fatal, messages, sourceType, ext } }
"use strict";
const path = require("path");
const ESLINT = process.env.ESLINT_DIR || "/workspace/ref/eslint";
const TSESLINT = process.env.TSESLINT_DIR || "/workspace/ref/tseslint";
const { Linter } = require(path.join(ESLINT, "lib/linter"));
// The package has `exports` and no `main`: a path into node_modules does not resolve, the name from its root does.
const tsParser = require("module").createRequire(TSESLINT + "/")("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const EXTS = ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"];
const isTs = ext => ext === "ts" || ext === "tsx" || ext === "mts" || ext === "cts";

function once(code, ext, rules, sourceType, jsx) {
	const languageOptions = { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	if (isTs(ext)) languageOptions.parser = tsParser;
	const config = [
		{
			// A pattern that ends in `/*` matches no file by itself in a flat config: every extension is named.
			files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
			languageOptions,
			linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
			rules: Object.fromEntries(rules.map(r => [r, "error"])),
		},
	];
	// typescript-eslint reads JSX from the extension of the file name: `.tsx` has it, `.ts`, `.mts` and `.cts` do not.
	return linter.verify(code, config, { filename: `c.${ext}` });
}

// `sourceType` undefined: for `.js` the first of script and module that the parser takes, then the same with JSX (the extension becomes jsx).
function verify(code, ext, rules, sourceType) {
	let tries;
	if (sourceType) tries = [[sourceType, ext === "jsx" || ext === "tsx", ext]];
	else if (ext === "js") tries = [["script", false, "js"], ["module", false, "js"], ["script", true, "jsx"], ["module", true, "jsx"]];
	else if (ext === "jsx") tries = [["script", true, "jsx"], ["module", true, "jsx"]];
	else if (ext === "mjs") tries = [["module", false, "mjs"]];
	else if (ext === "cjs") tries = [["commonjs", false, "cjs"]];
	else if (ext === "cts") tries = [["commonjs", false, "cts"]];
	else tries = [["module", ext === "tsx", ext]];
	let first = null;
	for (const [type, jsx, asExt] of tries) {
		const messages = once(code, asExt, rules, type, jsx);
		const fatal = messages.find(m => m.fatal) || null;
		const result = { fatal, messages: messages.filter(m => !m.fatal && m.ruleId !== null), sourceType: type, ext: asExt };
		if (!fatal) return result;
		first = first || result;
	}
	return first;
}

module.exports = { EXTS, isTs, verify, ESLINT, TSESLINT };
