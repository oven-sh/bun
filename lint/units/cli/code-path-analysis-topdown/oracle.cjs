// Research scratch: what ESLint at the pin emits for the code paths of a source: the arrows of every code path
// (debug-helpers makeDotArrows at onCodePathEnd) and every code path event in order, without the node argument.
// exports: oracle(code, { ts, jsx, sourceType }) -> { arrows, events } | { error }
"use strict";
const path = require("path");
const R = "/workspace/ref/eslint";
const { Linter } = require(path.join(R, "lib/linter"));
const debug = require(path.join(R, "lib/linter/code-path-analysis/debug-helpers"));
let tsParser = null;
function getTsParser() {
	if (!tsParser) tsParser = require("module").createRequire("/workspace/ref/tseslint/package.json")("@typescript-eslint/parser");
	return tsParser;
}
const linter = new Linter();

function once(code, languageOptions, withNodes) {
	const arrows = [];
	const events = [];
	const rule = {
		create(context) {
			const handlers = {
				onCodePathStart(codePath) {
					events.push(`onCodePathStart ${codePath.id} ${codePath.origin}`);
				},
				onCodePathEnd(codePath) {
					events.push(`onCodePathEnd ${codePath.id}`);
					arrows.push(debug.makeDotArrows(codePath));
				},
				onCodePathSegmentStart(segment) {
					events.push(`onCodePathSegmentStart ${segment.id}`);
				},
				onCodePathSegmentEnd(segment) {
					events.push(`onCodePathSegmentEnd ${segment.id}`);
				},
				onUnreachableCodePathSegmentStart(segment) {
					events.push(`onUnreachableCodePathSegmentStart ${segment.id}`);
				},
				onUnreachableCodePathSegmentEnd(segment) {
					events.push(`onUnreachableCodePathSegmentEnd ${segment.id}`);
				},
				onCodePathSegmentLoop(from, to) {
					events.push(`onCodePathSegmentLoop ${from.id} ${to.id}`);
				},
			};
			return handlers;
		},
	};
	const messages = linter.verify(code, {
		plugins: { t: { rules: { r: rule } } },
		rules: { "t/r": 2 },
		languageOptions,
	});
	const fatal = messages.find(m => m.fatal);
	if (fatal) return { error: `${fatal.line}:${fatal.column} ${fatal.message}` };
	return { arrows, events };
}

function oracle(code, { ts = false, jsx = true, sourceType = null } = {}) {
	if (ts) {
		return once(code, { parser: getTsParser(), parserOptions: { ecmaFeatures: { jsx } }, sourceType: "module" });
	}
	const order = ["module", "commonjs", "script"];
	if (sourceType && order.includes(sourceType)) {
		order.splice(order.indexOf(sourceType), 1);
		order.unshift(sourceType);
	}
	let first = null;
	for (const type of order) {
		const result = once(code, { ecmaVersion: "latest", sourceType: type, parserOptions: { ecmaFeatures: { jsx } } });
		if (!result.error) return result;
		first = first || result;
	}
	return first;
}

module.exports = { oracle };
