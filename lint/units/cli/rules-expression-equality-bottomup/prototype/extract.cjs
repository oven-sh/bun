// Extracts the valid and invalid cases of an ESLint rule test file as JSON.
"use strict";
const path = require("path");
const Module = require("module");
const file = process.argv[2];
const out = { valid: [], invalid: [] };
const fakeTester = class {
	run(name, rule, tests) {
		out.valid = tests.valid;
		out.invalid = tests.invalid;
	}
};
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
	if (id.endsWith("rule-tester/rule-tester")) return fakeTester;
	if (id.startsWith("../../../lib/rules/")) return {};
	return orig.apply(this, arguments);
};
require(path.resolve(file));
process.stdout.write(JSON.stringify(out, null, 1));
