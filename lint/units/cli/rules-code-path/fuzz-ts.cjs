// Research scratch (rules-code-path): TypeScript syntax sprinkled over the JavaScript fuzz lists, for rules-sim.cjs.
// Only syntax that leaves no name inside a type (keyword types): a name in a type is a throwable for ESLint (HOWTO).
// usage: node fuzz-ts.cjs <in.json> <out.json> <seed> [max]
"use strict";
const fs = require("fs");
const [input, output, seed, max] = [process.argv[2], process.argv[3], Number(process.argv[4] || 1), Number(process.argv[5] || 1e9)];
let state = seed >>> 0 || 1;
const rnd = n => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state % n; };
const pick = a => a[rnd(a.length)];
const out = [];
for (const code of JSON.parse(fs.readFileSync(input, "utf8")).slice(0, max)) {
	let s = code;
	// a type on a declared variable, around a `this`, after a `super()` call, around a simple operand
	s = s.replace(/\bvar ([a-z]) = /gu, (m, v) => (rnd(2) ? `var ${v}: ${pick(["any", "number", "unknown", "string | null"])} = ` : m));
	s = s.replace(/\bthis\.x = 1;/gu, m => pick([m, "(this as any).x = 1;", "this!.x = 1;", "(<any>this).x = 1;", "(this satisfies object).x = 1;"]));
	s = s.replace(/\bsuper\(\);/gu, m => pick([m, m, "super() as any;", "super()!;", "(<any>super());", "(super() satisfies unknown);"]));
	s = s.replace(/\bsuper\.y;/gu, m => pick([m, "super.y!;", "(super.y as any);"]));
	s = s.replace(/\breturn ([a-z]);/gu, (m, v) => pick([m, `return ${v} as any;`, `return ${v}!;`, `return <any>${v};`]));
	s = s.replace(/\bthrow ([a-z]);/gu, (m, v) => pick([m, `throw ${v} as any;`, `throw ${v}!;`]));
	s = s.replace(/\bcase ([a-z]):/gu, (m, v) => pick([m, `case ${v} as any:`, `case (${v})!:`, `case <any>${v}:`]));
	s = s.replace(/\bconstructor\(\)/gu, m => pick([m, m, "public constructor()", "constructor(private q?: number)", "constructor(); constructor()"]));
	s = s.replace(/\) \{ /u, m => (rnd(3) ? m : "): void { "));
	out.push({ code: s, ext: "ts" });
}
fs.writeFileSync(output, JSON.stringify(out));
console.log("cases", out.length);
