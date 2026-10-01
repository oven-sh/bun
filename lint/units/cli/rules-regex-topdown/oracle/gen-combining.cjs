// Research scratch: the table of `isCombiningCharacter` (lib/rules/utils/unicode/is-combining-character.js): General_Category M (Mn, Mc, Me).
// ESLint asks the engine (`/^\p{M}$/u`), so its answer is the Unicode version of the Node that runs it. This prints the ranges of the
// engine that runs this script, as a Rust item.    node gen-combining.cjs [check <file.rs>]
"use strict";
const re = /^\p{M}$/u;
const ranges = [];
for (let cp = 0; cp <= 0x10ffff; cp++) {
	if (cp >= 0xd800 && cp <= 0xdfff) continue;
	if (!re.test(String.fromCodePoint(cp))) continue;
	const last = ranges[ranges.length - 1];
	if (last && last[1] === cp - 1) last[1] = cp;
	else ranges.push([cp, cp]);
}
const hex = n => "0x" + n.toString(16).toUpperCase().padStart(4, "0");
let out = `// General_Category M of Unicode ${process.versions.unicode}: ${ranges.length} ranges, ${ranges.reduce((n, [a, b]) => n + b - a + 1, 0)} code points.\n`;
out += `pub(crate) static COMBINING: [(u32, u32); ${ranges.length}] = [\n`;
for (let i = 0; i < ranges.length; i += 6) out += "    " + ranges.slice(i, i + 6).map(([a, b]) => `(${hex(a)}, ${hex(b)})`).join(", ") + ",\n";
out += "];\n";
if (process.argv[2] === "check") {
	const have = require("fs").readFileSync(process.argv[3], "utf8");
	console.log(have.includes(out) ? "the table is the one of this engine" : "the table differs");
} else process.stdout.write(out);
