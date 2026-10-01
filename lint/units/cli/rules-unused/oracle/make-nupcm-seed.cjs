// Research scratch of "rules-unused": the seed of test/cli/lint/rules/no-unused-private-class-members.json.
// node make-nupcm-seed.cjs > seed/no-unused-private-class-members.json
// ESLint's own cases (eslintTest), the edge lists, and the cases of typescript-eslint's test of its rule of the same name, each
// with what ESLint's CORE rule answers as a lint run is configured (`expect`). A case that ESLint's parser rejects is left out.
"use strict";
const { ask } = require("./nupcm-oracle.cjs");
const own = require("../cases/upstream-no-unused-private-class-members.json");
const lists = [
	...[...own.valid, ...own.invalid].map(c => ({ code: c.code, ext: "js", eslintTest: true })),
	...require("../cases/nupcm-edge-js.json"),
	...require("../cases/nupcm-edge-ts.json"),
	...(j => [...j.valid, ...j.invalid].map(c => ({ code: c.code, ext: "ts" })))(require("../cases/tseslint-no-unused-private-class-members.json")),
];
const seen = new Set();
const out = [];
let rejected = 0;
for (const c of lists) {
	const key = `${c.ext}:${c.code}`;
	if (seen.has(key)) continue;
	seen.add(key);
	const answer = ask(c.code, c.ext);
	if (answer[0] && answer[0].startsWith("FATAL")) { rejected++; continue; }
	const item = { code: c.code };
	if (c.ext !== "js") item.ext = c.ext;
	item.expect = answer.map(line => { const m = /^(\d+):(\d+) (.*)$/s.exec(line); return { line: Number(m[1]), column: Number(m[2]), message: m[3] }; });
	if (c.eslintTest) item.eslintTest = true;
	out.push(item);
}
process.stderr.write(JSON.stringify({ cases: out.length, rejected, reports: out.reduce((n, c) => n + c.expect.length, 0), js: out.filter(c => !c.ext).length, ts: out.filter(c => c.ext === "ts").length }) + "\n");
process.stdout.write("[\n" + out.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n");
