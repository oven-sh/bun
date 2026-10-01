// Prints the code points of General_Category Mark (Mc, Me, Mn), what `/^\p{M}$/u` of ESLint's isCombiningCharacter matches,
// as a Rust table of inclusive ranges: first, last, first, last, ... in rising order. The data is that of the engine that runs this.
// usage: node gen-mark-ranges.cjs rust | check
"use strict";
const re = /^\p{M}$/u;
const ranges = [];
let start = -1;
for (let cp = 0; cp <= 0x110000; cp++) {
	const is = cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) && re.test(String.fromCodePoint(cp));
	if (is && start < 0) start = cp;
	if (!is && start >= 0) {
		ranges.push([start, cp - 1]);
		start = -1;
	}
}
const flat = ranges.flat();
if (process.argv[2] === "rust") {
	console.log(`/// General_Category Mark (Mc, Me, Mn) of Unicode ${process.versions.unicode}: inclusive ranges, first then last.`);
	console.log(`static MARK_RANGES: [u32; ${flat.length}] = [`);
	let line = "   ";
	for (const n of flat) {
		const item = ` 0x${n.toString(16).toUpperCase()},`;
		if (line.length + item.length > 100) {
			console.log(line);
			line = "   ";
		}
		line += item;
	}
	console.log(line);
	console.log("];");
} else {
	console.log(`unicode ${process.versions.unicode} ranges ${ranges.length} numbers ${flat.length} code points ${ranges.reduce((a, [f, l]) => a + l - f + 1, 0)} sum ${flat.reduce((a, n) => a + n, 0)} first ${flat[0].toString(16)} last ${flat.at(-1).toString(16)}`);
}
