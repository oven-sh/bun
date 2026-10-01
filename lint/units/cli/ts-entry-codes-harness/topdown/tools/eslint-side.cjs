// DRAFT of the research unit "ts-entry-codes-harness" (top-down pass) for /workspace/notes/lint/units/cli/tools/.
// ESLint at the pin as the oracle of `bun --lint`: configured as a lint run behaves, not as ESLint's own test configures it.
//   the latest edition, no inline configuration, and the source type that the extension of the file gives:
//   .cjs and .cts are commonjs, every other extension is a module. No file is a script.
//   A TypeScript extension is parsed by @typescript-eslint/parser, which reads JSX in .tsx only.
// Needs: sh /workspace/notes/lint/units/cli/tools/eslint-oracle-setup.sh (makes /workspace/ref/eslint and /workspace/ref/tseslint).
// exports { ESLINT, TSESLINT, EXTS, isTs, sourceTypeOf, PLUGIN_RULES, verify, carry }
//   verify(code, ext, rules, { plugin }) -> { fatal, messages, sourceType, ext }
//   carry(code, ext, stated, rule)       -> { ext } | { ext: null, reason }    the extension that carries a case of ESLint's own test
"use strict";
const path = require("path");
const ESLINT = process.env.ESLINT_DIR || "/workspace/ref/eslint";
const TSESLINT = process.env.TSESLINT_DIR || "/workspace/ref/tseslint";
const { Linter } = require(path.join(ESLINT, "lib/linter"));
// The packages have `exports` and no `main`: a path into node_modules does not resolve, the name from the root does.
const fromTs = require("module").createRequire(TSESLINT + "/");
const tsParser = fromTs("@typescript-eslint/parser");
const tsPlugin = fromTs("@typescript-eslint/eslint-plugin");
const linter = new Linter({ configType: "flat" });
const EXTS = ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "d.ts", "d.mts", "d.cts"];
const isTs = ext => /(^|\.)[cm]?tsx?$/.test(ext);
const hasJsx = ext => ext === "jsx" || ext === "tsx";
const sourceTypeOf = ext => (/(^|\.)c[jt]s$/.test(ext) ? "commonjs" : "module");
// The rules of typescript-eslint that stand in for a core rule of the same name in a TypeScript file.
const PLUGIN_RULES = Object.keys(tsPlugin.rules).filter(name => !tsPlugin.rules[name].meta.deprecated && tsPlugin.rules[name].meta.docs && tsPlugin.rules[name].meta.docs.extendsBaseRule === true);

function once(code, ext, rules, sourceType, jsx, plugin) {
	const languageOptions = { ecmaVersion: "latest", sourceType, parserOptions: { ecmaFeatures: { jsx } } };
	const ts = isTs(ext);
	if (ts) languageOptions.parser = tsParser;
	const named = rule => (ts && plugin && PLUGIN_RULES.includes(rule) ? `@typescript-eslint/${rule}` : rule);
	const config = [
		{
			// A pattern that ends in `/*` matches no file by itself in a flat config: every extension is named.
			files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
			plugins: { "@typescript-eslint": tsPlugin },
			languageOptions,
			// `bun --lint` reads no comment that configures a run.
			linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
			rules: Object.fromEntries(rules.map(rule => [named(rule), "error"])),
		},
	];
	const messages = linter.verify(code, config, { filename: `c.${ext}` });
	for (const m of messages) if (m.ruleId && m.ruleId.startsWith("@typescript-eslint/")) m.ruleId = m.ruleId.slice("@typescript-eslint/".length);
	return messages;
}

function result(messages, sourceType, ext) {
	const fatal = messages.find(m => m.fatal) || null;
	// A message without a rule is the parser's, or says that a comment configures nothing.
	return { fatal, messages: messages.filter(m => !m.fatal && m.ruleId !== null), sourceType, ext };
}

// ESLint's answer for the file `c.<ext>`. A case without an extension of its own is a `.js` file: where ESLint rejects it
// as a module, it is the `.cjs` file (sloppy code: `with`, a legacy octal number, `-->`) or the `.jsx` file that ESLint
// takes, and the result names that extension. `options.sourceType` asks for one source type and tries nothing else.
function verify(code, ext, rules, options = {}) {
	const sourceType = options.sourceType || sourceTypeOf(ext);
	const first = result(once(code, ext, rules, sourceType, hasJsx(ext), options.plugin), sourceType, ext);
	if (!first.fatal || ext !== "js" || options.sourceType) return first;
	for (const other of ["cjs", "jsx"]) {
		const next = result(once(code, other, rules, sourceTypeOf(other), hasJsx(other), options.plugin), sourceTypeOf(other), other);
		if (!next.fatal) return next;
	}
	return first;
}

const key = r => (r.fatal ? null : JSON.stringify(r.messages.map(m => `${m.line}:${m.column} ${m.message}`).sort()));

// A case of ESLint's own test has a source type of its own: `stated`, "module" where the test says nothing.
// It is carried by the first extension whose source type gives the answer of the test's own source type:
// the module extension, then the commonjs one, each without JSX first (a test can turn JSX on for all its cases).
function carry(code, ext, stated, rule) {
	const own = key(result(once(code, ext, [rule], stated, hasJsx(ext)), stated, ext));
	if (own === null) return { ext: null, reason: `ESLint rejects it as ${stated}` };
	const ts = isTs(ext);
	const candidates = ts ? ["ts", "cts"] : ["js", "cjs"];
	if (hasJsx(ext)) candidates.push(ts ? "tsx" : "jsx");
	for (const candidate of candidates) {
		const sourceType = sourceTypeOf(candidate);
		if (key(result(once(code, candidate, [rule], sourceType, hasJsx(candidate)), sourceType, candidate)) === own) return { ext: candidate };
	}
	return { ext: null, reason: `its answer as ${stated} is the answer of no extension` };
}

module.exports = { ESLINT, TSESLINT, EXTS, isTs, sourceTypeOf, PLUGIN_RULES, verify, carry };
if (require.main === module) console.log(JSON.stringify({ EXTS, PLUGIN_RULES }));
