// Research scratch: ESLint's own expectation of each case against what ESLint reports under the configuration of a lint run of Bun.
// usage: node compare-upstream.cjs <rule>     reads cases/upstream-<rule>.json and vectors/upstream-<rule>.json
"use strict";
const rule = process.argv[2];
const up = require(`../cases/upstream-${rule}.json`);
const vec = new Map(require(`../vectors/upstream-${rule}.json`).map(v => [v.code, v]));
const show = r => (r === null ? "FATAL" : r.length === 0 ? "-" : r.map(x => `${x.line}:${x.column}`).join(","));
let same = 0;
for (const kind of ["valid", "invalid"])
	for (const c of up[kind]) {
		const v = vec.get(c.code);
		const want = kind === "valid" ? 0 : typeof c.errors === "number" ? c.errors : c.errors.length;
		const m = v.module, j = v.commonjs;
		const okM = m !== null && m.length === want, okJ = j !== null && j.length === want;
		if (okM && (okJ || j === null)) { same++; continue; }
		const lo = c.languageOptions || {};
		console.log(`${kind} want=${want} module=${show(m)} commonjs=${show(j)} bun=${v.bunJs === "ok" ? "ok" : "REJ"} ${JSON.stringify(c.code).slice(0, 110)}  [${lo.sourceType || "module"} es${lo.ecmaVersion || "latest"}${lo.globals ? " globals:" + Object.keys(lo.globals).slice(0, 3).join(",") + (Object.keys(lo.globals).length > 3 ? ",..." : "") : ""}${c.options ? " options:" + JSON.stringify(c.options) : ""}]`);
	}
console.log(`${rule}: ${same} cases keep ESLint's own expectation as a module (and as commonjs where that parses)`);
