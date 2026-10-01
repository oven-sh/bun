// Writes patterns made of random pieces with what regexpp's parsePattern answers: the entry that ESLint's rules call.
// usage: node gen-patterns.cjs <out file> [cases per weight unit, default 160] [seed, default 1]
// A line `# pattern <ecmaVersion or -> <strict 0, 1 or -> <flags: -, u, v or uv>` gives the options of the cases after it.
// A case: `<pattern> <dump>`, `<pattern> ! <index> <message>` for a RegExpSyntaxError, `<pattern> !!` for any other error.
"use strict";
const fs = require("fs");
const { q, checkInvariants, dump } = require("./lib.cjs");
const regexpp = require(process.env.REGEXPP_BUILD || "/workspace/ref/eslint/node_modules/@eslint-community/regexpp");

const out = process.argv[2];
const unit = Number(process.argv[3] || 160);
let state = Number(process.argv[4] || 1) >>> 0;
// mulberry32
function random() {
	state = (state + 0x6d2b79f5) >>> 0;
	let t = state;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = list => list[Math.floor(random() * list.length)];

// Pieces that stand alone.
const ATOMS = [
	"a", "b", "c", "k", "u", "1", "0", "_", " ", ",", "!", "#", "&", "=", "<", ">", ":", "-", "/", "}", "]", "{",
	"^", "$", ".", "\\b", "\\B", "\\d", "\\D", "\\w", "\\W", "\\s", "\\S", "\\n", "\\t", "\\v", "\\f", "\\r",
	"\\k<n>", "\\k<a>", "\\1", "\\2", "\\3", "\\10", "\\0", "\\00", "\\07", "\\377", "\\400", "\\8",
	"\\cA", "\\c1", "\\c_", "\\c", "\\x41", "\\x4", "\\u0041", "\\u004", "\\u{41}", "\\u{110000}", "\\u",
	"\\ud83d\\ude00", "\\ud83d", "\\ude00", "\\u{1f600}",
	"\\p{L}", "\\P{Lu}", "\\p{Script=Greek}", "\\p{sc=Grek}", "\\p{scx=Kawi}", "\\p{gc=L}", "\\p{General_Category=Letter}",
	"\\p{ASCII}", "\\p{Any}", "\\p{Extended_Pictographic}", "\\p{EBase}", "\\p{RGI_Emoji}", "\\P{RGI_Emoji}", "\\p{Basic_Emoji}",
	"\\p{Script=Unknown}", "\\p{Script=Nope}", "\\p{Nope}", "\\p{L", "\\p", "\\p{=L}",
	"\\-", "\\/", "\\^", "\\$", "\\.", "\\(", "\\)", "\\[", "\\]", "\\{", "\\}", "\\|", "\\\\", "\\a", "\\e", "\\z", "\\_", "\\ ", "\\&", "\\!", "\\,",
	"\u00e9", "\u03b1", "\u200d", "\u2028", "\ud83d\ude00", "\ud83d", "\ude00", "\ud835\udc9c",
];
const QUANTIFIERS = ["*", "+", "?", "{1}", "{1,}", "{1,2}", "{2,1}", "{,2}", "{a}", "{1", "*?", "+?", "??", "{1}?", "{12,34}?"];
const OPENERS = [
	"(", "(", "(?:", "(?:", "(?=", "(?!", "(?<=", "(?<!", "(?<n>", "(?<a>", "(?<n>", "(?<$_>", "(?<\\u0061>", "(?<\\u{61}>",
	"(?<\ud835\udc9c>", "(?<1>", "(?<>", "(?", "(?<", "(?i:", "(?i-m:", "(?-s:", "(?-:", "(?ii:", "(?i-i:", "(?ims-:", "(?x:",
];
// Pieces inside `[` and `]`.
const CLASS = [
	"a", "b", "z", "0", "9", "-", "-", "^", "_", " ", ",", "!", "&", "(", ")", "{", "}", "/", "|", "\\", "\\]", "\\[", "\\-", "\\b", "\\B",
	"\\d", "\\w", "\\S", "\\n", "\\cA", "\\c1", "\\c_", "\\c", "\\x41", "\\u0041", "\\u{41}", "\\ud83d\\ude00", "\\0", "\\07", "\\1", "\\8", "\\k",
	"\\p{L}", "\\P{Lu}", "\\p{RGI_Emoji}", "\\p{Nope}", "\\q{a|bc}", "\\q{}", "\\q{a}", "\\q{", "&&", "--", "&&&", "!!", "##", "^^", "\\&", "\\!",
	"[a]", "[^a]", "[a-z]", "[", "[\\q{ab}]", "[^\\q{ab}]", "[^\\q{a}]", "\u00e9", "\u200d", "\ud83d\ude00", "\ud83d", "\ude00", "a-z", "z-a", "\\d-a", "a-\\d",
];
// Patterns that every group of options gets first: the paths that random pieces seldom reach.
const ALWAYS = [
	"", "\\", "a\\", "(a)\\", "[a]\\", "(?<n>a)\\",
	"(?<n>a)|(?<n>b)", "(?<n>a)|((?<n>b))", "((?<n>a))|(?<n>b)", "((?<n>a))|((?<n>b))", "(?<n>a)(?<n>b)", "(?<n>a)|(?<n>b)(?<n>c)",
	"(?:(?<n>a)|(?<n>b))\\k<n>", "(?<n>a)(?:b|(?<n>c))", "(?:(?<n>a)|b)(?<n>c)", "(?:(?:(?<n>a)|b)|c)|(?<n>d)", "(?<n>a)|(?:b(?:c|(?<n>d)))",
	"(?<n>a)|(?<m>b)|(?<n>c)\\k<n>\\k<m>", "\\k<n>(?<n>a)", "\\k<m>(?<n>a)", "(?<n>\\k<n>)", "\\1(a)", "(a)\\2", "(a)(b)\\2\\1", "(?=(a))\\1", "(?<=(a))\\1", "(?!(?<n>a))\\k<n>",
	// No deeper than this: regexpp's BranchID.separatedFrom takes four times as long for each level more.
	"((((((((?<n>a)(?<n>b))))))))", "((((((((?<n>a)|(?<n>b))))))))",
	"a{9007199254740993,9007199254740992}", "a{99999999999999999999999}", "a{0}", "a{0,0}?", "\\99999999999999999999999", "\\u{00000000000000000000000000000041}",
	"[\\d-a]", "[a-\\d]", "[\\d-\\w]", "[a-]", "[-a]", "[a-b-c]", "[\\c]", "[\\c1-\\c_]", "\\c", "\\c1", "[^]", "[]", "[]]", "[[]]", "[^[]]",
	"[a&&b&&c]", "[a--b--c]", "[a&&b--c]", "[a--b&&c]", "[[a]&&[b]]", "[^[a]--[b]]", "[\\q{a|bc}--\\q{a}]", "[^\\q{ab}]", "[^\\q{a}]", "[^\\q{}]", "[\\p{RGI_Emoji}--a]", "[^\\p{RGI_Emoji}]", "[a-z&&b]", "[&&]", "[a&&]", "[a&&&b]", "[a-]&&b]",
	"(?i:a)", "(?-i:a)", "(?i-:a)", "(?-:a)", "(?i-i:a)", "(?im-s:a)", "(?ii:a)", "(?:a)", "(?", "(?a)", "(?<", "(?<n", "(?<n>", "(?<n>a", "(", ")", "]", "}", "{", "{1}", "a{1", "a{", "a{,}", "a{1,2", "a**", "a?+", "^*", "$+", "\\b+", "(?=a)*", "(?<=a)*", "(?!a){2}",
	"\ud83d\ude00", "[\ud83d\ude00]", "\ud83d", "[\ude00-\ud83d]", "[\ud83d-\ude00]", "(?<\ud835\udc9c>a)", "(?<\\ud835\\udc9c>a)", "(?<\\u{1d49c}>a)\\k<\ud835\udc9c>", "(?<a\u200d>b)", "(?<\u200d>b)",
	"\\p{Script=Greek}", "\\p{Script_Extensions=Greek}", "\\p{scx=Kawi}", "\\p{sc=Berf}", "\\p{gc=Lu}", "\\p{Lu}", "\\p{Any}", "\\p{EBase}", "\\p{Extended_Pictographic}", "\\P{Basic_Emoji}", "\\p{Basic_Emoji}", "\\p{=}", "\\p{L=}", "\\p{}", "\\p{L}\\P{L}",
];
const GROUPS = [
	// What ESLint's rules run: no options, so ES2025 and not strict.
	...["-", "u", "v", "uv"].map(flags => ({ version: "-", strict: "-", flags, weight: flags === "uv" ? 0.1 : 6 })),
	...[5, 2015, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].flatMap(version =>
		["0", "1"].flatMap(strict => ["-", "u", "v"].map(flags => ({ version: String(version), strict, flags, weight: 0.3 }))),
	),
];

function make() {
	let pattern = "";
	const closers = [];
	// Whether a quantifier may follow: the last piece was an atom or closed something.
	let quantifiable = false;
	for (let n = 1 + Math.floor(random() * 7); n > 0; n--) {
		const r = random();
		if (closers.at(-1) === "]") {
			if (r < 0.25) {
				pattern += closers.pop();
				quantifiable = true;
			} else pattern += pick(CLASS);
		} else if (r < 0.5) {
			pattern += pick(ATOMS);
			quantifiable = true;
		} else if (r < 0.62) {
			// A quantifier with nothing before it is rare.
			if (quantifiable || random() < 0.08) pattern += pick(QUANTIFIERS);
			else pattern += pick(ATOMS);
			quantifiable = false;
		} else if (r < 0.74) {
			pattern += pick(OPENERS);
			closers.push(")");
			quantifiable = false;
		} else if (r < 0.86) {
			pattern += random() < 0.25 ? "[^" : "[";
			closers.push("]");
			quantifiable = false;
		} else if (r < 0.93) {
			pattern += "|";
			quantifiable = false;
		} else if (closers.length > 0) {
			pattern += closers.pop();
			quantifiable = true;
		} else pattern += pick([")", "]", "}"]);
	}
	// Most patterns close what they opened.
	while (closers.length > 0) {
		const closer = closers.pop();
		if (random() < 0.95) pattern += closer;
	}
	return pattern;
}

const lines = [];
const tally = { ast: 0, syntax: 0, other: 0 };
const messages = new Map();
for (const group of GROUPS) {
	lines.push(`# pattern ${group.version} ${group.strict} ${group.flags}`);
	const options = {};
	if (group.version !== "-") options.ecmaVersion = Number(group.version);
	if (group.strict !== "-") options.strict = group.strict === "1";
	const flags = { unicode: group.flags.includes("u"), unicodeSets: group.flags.includes("v") };
	const parser = new regexpp.RegExpParser(options);
	const count = Math.round(unit * group.weight);
	const seen = new Set();
	// The whole list for what ESLint's rules run, and for one set of flags of each older edition.
	const production = group.version === "-" && group.flags !== "uv";
	const sample = group.strict === "0" && group.flags === { 5: "-", 2015: "u", 2017: "-", 2018: "u", 2019: "-", 2020: "-", 2021: "u", 2022: "-", 2023: "u", 2024: "v", 2025: "-" }[group.version];
	const strict = group.strict === "1" && group.version === "2025";
	const fixed = production || sample || strict ? ALWAYS.slice() : [];
	for (let made = 0, tries = 0; fixed.length > 0 || (made < count && tries < count * 20); tries++) {
		const pattern = fixed.length > 0 ? fixed.shift() : make();
		if (seen.has(pattern)) continue;
		seen.add(pattern);
		if (fixed.length === 0) made++;
		let result;
		try {
			const ast = parser.parsePattern(pattern, 0, pattern.length, flags);
			checkInvariants(ast, pattern);
			result = dump(ast);
			tally.ast++;
		} catch (error) {
			if (error instanceof regexpp.RegExpSyntaxError) {
				result = `! ${error.index} ${q(error.message)}`;
				tally.syntax++;
				const short = error.message.slice(error.message.lastIndexOf(": ") + 2).replace(/'.*'/, "'?'");
				messages.set(short, (messages.get(short) || 0) + 1);
			} else {
				result = "!!";
				tally.other++;
				console.log("other:", String(error).slice(0, 80), q(pattern), JSON.stringify(group));
			}
		}
		lines.push(`${q(pattern)} ${result}`);
	}
}
const text = lines.join("\n") + "\n";
if (/[^\x0a\x20-\x7e]/.test(text)) throw new Error("not printable ASCII");
fs.writeFileSync(out, text);
console.log({ bytes: text.length, lines: lines.length, ...tally });
console.log([...messages].sort((x, y) => y[1] - x[1]).map(([m, n]) => `${n} ${m}`).join("\n"));
