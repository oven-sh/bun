// Research scratch: compares proto/lop.rs with `losesPrecision` of ESLint at the pin on generated literals and on ESLint's own cases.
// usage: node lop-check.cjs /tmp/lop [count] [seed]
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const [bin, countArg, seedArg] = process.argv.slice(2);
const count = Number(countArg || 20000);
let seed = Number(seedArg || 1);
const rnd = () => {
	// mulberry32
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = n => Math.floor(rnd() * n);
const pick = a => a[int(a.length)];
const digits = (n, set = "0123456789") => Array.from({ length: n }, () => pick(set)).join("");
const sep = s => (rnd() < 0.2 && s.length > 2 ? s.slice(0, 1) + s.slice(1).replace(/(\d)(?=\d)/g, (m, d) => (rnd() < 0.2 ? d + "_" : d)) : s);
function literal() {
	const k = int(14);
	if (k === 0) return pick(["0x", "0X"]) + digits(1 + int(pick([4, 14, 15, 16, 20, 300])), "0123456789abcdefABCDEF");
	if (k === 1) return pick(["0b", "0B"]) + digits(1 + int(pick([8, 53, 54, 60, 1100])), "01");
	if (k === 2) return pick(["0o", "0O"]) + digits(1 + int(pick([6, 18, 19, 22, 400])), "01234567");
	if (k === 3) return "0" + digits(1 + int(pick([3, 17, 18, 19, 22])), "01234567");
	if (k === 4) return "0" + digits(int(4), "01234567") + pick("89") + digits(int(pick([3, 16, 20]))) + (rnd() < 0.3 ? "." + digits(int(5)) : "");
	let ip = k === 5 ? "" : k === 6 ? "0" : pick("123456789") + digits(int(pick([1, 3, 15, 16, 17, 18, 25, 40, 110])));
	if (k === 7) ip = pick(["9007199254740", "900719925474099", "1125899906842624", "4503599627370496", "2251799813685248", "562949953421312"]) + digits(int(3));
	let fp = "";
	const f = int(5);
	if (k === 5 || f === 0) fp = "." + digits(1 + int(pick([1, 3, 15, 17, 20, 30, 105])));
	else if (f === 1) fp = ".";
	else if (f === 2) fp = "." + "0".repeat(int(pick([3, 20, 30]))) + digits(1 + int(pick([2, 5, 17])));
	if (k === 8) fp = "." + pick(["25", "5", "75", "125", "375", "0625", "2", "3", "1", "7", "8"]);
	let ep = "";
	if (rnd() < 0.35) ep = pick("eE") + pick(["", "+", "-"]) + String(int(pick([3, 25, 330, 400, 4000])));
	return sep(ip) + (fp.length > 1 ? "." + sep(fp.slice(1)) : fp) + ep;
}
const list = new Set();
for (const rule of ["no-loss-of-precision", "no-octal"]) {
	const file = path.join(__dirname, "..", "cases", `upstream-${rule}.json`);
	for (const c of JSON.parse(fs.readFileSync(file, "utf8"))) {
		const m = /(?:^|[= ])-?((?:\d|\.\d)[\w.]*(?:[eE][+-]?[\d_]+)?)\s*;?$/.exec(c.code);
		if (m) list.add(m[1]);
	}
}
// Ties of toPrecision, the ends of the range, and the literals of the notes.
for (const s of ["1125899906842624.2", "1125899906842624.3", "2251799813685248.2", "2251799813685248.3", "2251799813685248.7", "562949953421312.12", "562949953421312.13", "562949953421312.62", "562949953421312.63", "1.7976931348623157e308", "1.7976931348623158e308", "1.7976931348623159e308", "1.8e308", "5e-324", "4e-324", "2.5e-324", "2.4e-324", "4.9e-324", "1e-323", "1.5e-323", "2.2250738585072014e-308", "2.225073858507201e-308", "0", "0.0", "0.", ".0", "0e0", "0.0e5", "00", "08", "09.5", "0.1", "0.3", "1e21", "1e22", "1e23", "123456789012345680000", "0.1e1", "5e-7", "0.0000001", "1.0", "100", "1e2", "10e1", "9.995e0", "0.30000000000000004", "0.1000000000000000055511151231257827"]) list.add(s);
while (list.size < count) list.add(literal());
const espree = require("/workspace/ref/eslint/node_modules/espree");
const literals = [...list].filter(s => {
	try {
		espree.parse(`(${s})`, { ecmaVersion: "latest", sourceType: "script" });
		return true;
	} catch {
		return false;
	}
});
// One literal per line: a report names the line of its literal.
const reported = new Set(
	linter
		.verify(literals.map(s => `(${s});`).join("\n"), [{ languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { "no-loss-of-precision": "error" } }])
		.map(m => {
			if (m.fatal) throw new Error(m.message);
			return m.line - 1;
		}),
);
const expected = literals.map((s, i) => (reported.has(i) ? 1 : 0));
const r = spawnSync(bin, [], { input: literals.join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 28 });
if (r.status !== 0) {
	console.error("the binary failed", r.status, r.signal, r.stderr.slice(0, 2000));
	process.exit(1);
}
const got = r.stdout.trim().split("\n").map(Number);
let wrong = 0;
literals.forEach((s, i) => {
	if (got[i] !== expected[i]) {
		wrong++;
		if (wrong <= 40) console.log("DIFFERS", s, "eslint", expected[i], "proto", got[i]);
	}
});
console.log(`literals ${literals.length} (of ${list.size} generated), reported by eslint ${expected.filter(Boolean).length}, wrong ${wrong}`);
