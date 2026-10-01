// Prints the data of regexpp's src/unicode/ids.ts and src/unicode/properties.ts as Rust items, the strings unchanged.
// usage: node gen-unicode.cjs ids | properties | check
//   ids         the two range tables, each string cut after a space into pieces of at most 92 characters
//   properties  the sets of property names and values, one constant for each set that is not empty
//   check       numbers for a test: how many ranges, the sum of all bounds, how many names in each set
"use strict";
const fs = require("fs");
const REF = process.env.REGEXPP || "/workspace/ref/regexpp";
const ids = fs.readFileSync(`${REF}/src/unicode/ids.ts`, "utf8");
const properties = fs.readFileSync(`${REF}/src/unicode/properties.ts`, "utf8");

const banner = /^\/\* (Generated from [^*]*?) \*\//.exec(ids)[1];
const tables = [...ids.matchAll(/function (initLargeId\w+Ranges)\(\): number\[\] \{\s*return restoreRanges\(\s*"([0-9a-z ]+)",?\s*\)/g)].map(m => ({ name: m[1], data: m[2] }));
if (tables.length !== 2) throw new Error("expected two tables in ids.ts");
const restore = data => {
	let last = 0;
	return data.split(" ").map(s => (last += parseInt(s, 36) | 0));
};
// Cut after a space: the pieces joined again are the string.
function pieces(data, width) {
	const out = [];
	let rest = data;
	while (rest.length > width) {
		const cut = rest.lastIndexOf(" ", width - 1) + 1;
		out.push(rest.slice(0, cut));
		rest = rest.slice(cut);
	}
	out.push(rest);
	if (out.join("") !== data) throw new Error("pieces do not join to the string");
	return out;
}
const sets = [...properties.matchAll(/const (\w+) = new DataSet\(([\s\S]*?)\n\)/g)].map(m => ({
	name: m[1],
	raw: [...m[2].matchAll(/"([^"]*)"/g)].map(x => x[1]),
}));
if (sets.length !== 4 || sets.some(s => s.raw.length !== 9)) throw new Error("expected four sets of nine strings in properties.ts");
const snake = s => s.replace(/[A-Z]/g, c => `_${c}`).toUpperCase();

const mode = process.argv[2];
if (mode === "ids") {
	console.log(`// ${banner}`);
	for (const { name, data } of tables) {
		const numbers = restore(data);
		const constant = name === "initLargeIdStartRanges" ? "LARGE_ID_START_RANGES" : "LARGE_ID_CONTINUE_RANGES";
		console.log(`static ${constant}: [u32; ${numbers.length}] = restore_ranges(concat!(`);
		for (const piece of pieces(data, 92)) console.log(`    "${piece}",`);
		console.log("));");
	}
} else if (mode === "properties") {
	for (const { name, raw } of sets) {
		raw.forEach((text, i) => {
			if (text === "") return;
			const constant = `${snake(name).replace(/_SETS$/, "")}_${2018 + i}`;
			const cut = pieces(text, 92);
			// rustfmt keeps one piece on the line of the constant, or alone on the next line.
			if (cut.length === 1) {
				const line = `const ${constant}: &str = "${text}";`;
				console.log(line.length <= 100 ? line : `const ${constant}: &str =\n    "${text}";`);
				return;
			}
			console.log(`const ${constant}: &str = concat!(`);
			for (const piece of cut) console.log(`    "${piece}",`);
			console.log(");");
		});
	}
} else if (mode === "check") {
	for (const { name, data } of tables) {
		const numbers = restore(data);
		console.log(name, "numbers", numbers.length, "sum", numbers.reduce((a, n) => a + n, 0), "first", numbers[0], "last", numbers.at(-1));
	}
	for (const { name, raw } of sets) console.log(name, raw.map((text, i) => `${2018 + i}:${text === "" ? 0 : text.split(" ").length}`).join(" "));
} else throw new Error("usage: node gen-unicode.cjs ids | properties | check");
