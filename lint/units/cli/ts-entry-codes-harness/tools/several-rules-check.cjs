const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const P = "/workspace/notes/lint/units/cli/round2-oracle/proto-1b";
const { verify } = require(path.join(P, "eslint-side.cjs"));
const rules = fs.readdirSync("/workspace/wt/cli/test/cli/lint/rules").map(f => f.slice(0, -5)).sort();
const js = [
	"let a = 1, b = 2, o, y, C;",
	"debugger;",
	"o = { k: 1, k: 2 };",
	"C = class { m() {} m() {} };",
	"switch (a) { case 1: break; case 1: break; }",
	"var {} = o;",
	"if (a === -0) b = 3;",
	"if (a == NaN) b = 4;",
	'if (typeof a === "strnig") b = 5;',
	"if (!a in o) b = 6;",
	"y = [1, , 2];",
	"a = a;",
	"export { a, b, o, y, C };",
	"",
].join("\n");
const ts = [
	"let a: number = 1, b = 2, o: Record<string, number>, y: (number | undefined)[], C: unknown;",
	"debugger;",
	"o = { k: 1, k: 2 } as Record<string, number>;",
	"C = class<T> { m(): void {} m(): void {} x!: T };",
	"switch (a as number) { case 1: break; case 1: break; }",
	"var {}: object = o!;",
	"if (a! === -0) b = 3;",
	"if ((a as number) == NaN) b = 4;",
	'if (typeof a === "strnig") b = 5;',
	"if (!a in o!) b = 6;",
	"y = [1, , 2] satisfies (number | undefined)[];",
	"a = a;",
	"namespace N { debugger; }",
	"enum E { A = 1 }",
	"export { a, b, o, y, C, N, E };",
	"",
].join("\n");
const env = { ...process.env, ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1" };
const out = [];
for (const [name, code] of [["several.js", js], ["several.ts", ts]]) {
	fs.writeFileSync(name, code);
	const ext = name.split(".").pop();
	const r = verify(code, ext, rules, "module");
	const theirs = r.fatal ? ["FATAL " + r.fatal.message] : r.messages.map(m => ({ l: m.line, c: m.column, t: `${name}(${m.line},${m.column}): error ${m.ruleId}: ${m.message.replace(/\r\n?|\n/g, " ")}` })).sort((x, y) => x.l - y.l || x.c - y.c || (x.t < y.t ? -1 : 1)).map(x => x.t);
	const run = spawnSync("/tmp/tsentry/tsentry", ["--lint", name], { env, encoding: "utf8" });
	const ours = run.stderr.split("\n").filter(Boolean);
	console.log(`== ${name}: exit ${run.status}, eslint ${theirs.length} lines, probe ${ours.length} lines, ${JSON.stringify(theirs) === JSON.stringify(ours) ? "SAME" : "DIFFERENT"}`);
	for (const l of ours) console.log("   " + l + (theirs.includes(l) ? "" : "     <-- not ESLint's"));
	for (const l of theirs) if (!ours.includes(l)) console.log("   ESLint only: " + l);
	out.push({ name, code, lines: ours.map(l => l.slice(name.length)) });
}
fs.writeFileSync("several-rules.json", "[\n" + out.map(c => "\t" + JSON.stringify(c)).join(",\n") + "\n]\n");
