// Research scratch: the edge lists by rule, in the names that the fixture tools take (<prefix>-<rule>.json).
// usage: node split.cjs <dump of drive.cjs over the edge lists>    writes td-edge-<rule>.json (js, jsx) and td-ts-<rule>.json (ts, tsx) beside itself
"use strict";
const fs = require("fs");
const path = require("path");
const RULES = ["no-control-regex", "no-regex-spaces", "no-useless-backreference", "no-misleading-character-class", "no-useless-escape"];
const CALL = new Set(RULES.slice(0, 4));
const lists = Object.fromEntries(["edge-calls", "edge-calls-ts", "edge-escape", "edge-escape-jsx", "edge-escape-ts", "edge-escape-tsx", "edge-directive", "edge-positions"].map(n => [n, new Set(JSON.parse(fs.readFileSync(path.join(__dirname, n + ".json"), "utf8")).map(c => (typeof c === "string" ? c : c.code)))]));
const out = {};
for (const line of fs.readFileSync(process.argv[2], "utf8").trim().split("\n")) {
	const c = JSON.parse(line);
	for (const rule of RULES) {
		const reported = c.eslint.some(r => r.rule === rule) || c.planned.some(r => r.rule === rule);
		const designed = CALL.has(rule) ? lists["edge-calls"].has(c.code) || lists["edge-calls-ts"].has(c.code) : ["edge-escape", "edge-escape-jsx", "edge-escape-ts", "edge-escape-tsx", "edge-directive"].some(n => lists[n].has(c.code));
		if (!reported && !designed) continue;
		const ts = /^[cm]?tsx?$/.test(c.ext);
		const name = `${ts ? "td-ts" : "td-edge"}-${rule}.json`;
		(out[name] = out[name] || []).push(c.ext === "js" ? { code: c.code } : { code: c.code, ext: c.ext });
	}
}
for (const [name, list] of Object.entries(out)) {
	fs.writeFileSync(path.join(__dirname, name), JSON.stringify(list, null, "\t") + "\n");
	console.log(name, list.length);
}
