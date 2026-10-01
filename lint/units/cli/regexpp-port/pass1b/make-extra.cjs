// Baselines for sources that upstream's own fixtures do not have (unpaired surrogates, numbers beyond 2^53, the
// entry for a pattern alone), made by running regexpp at the pin. Same line format as literal.txt, and two more kinds:
//   PA <ecmaVersion> <strict> <u 0|1> <v 0|1> <pattern> <fnv1a64 of the dump of parsePattern(pattern, 0, length, flags)>
//   PE <ecmaVersion> <strict> <u 0|1> <v 0|1> <pattern> <index> <message>
// usage: node make-extra.cjs <out dir>
"use strict";
const fs = require("fs"), path = require("path");
const regexpp = require("/workspace/ref/eslint/node_modules/@eslint-community/regexpp");
const { dump } = require("./dump-spec.cjs");
const esc = s => { let r = ""; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); r += c >= 0x20 && c <= 0x7e && c !== 0x25 ? s[i] : "%u" + c.toString(16).padStart(4, "0"); } return r; };
const fnv = text => { let h = 0xcbf29ce484222325n; for (const b of Buffer.from(text, "utf8")) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return h.toString(16).padStart(16, "0"); };
const LEAD = "\ud83d", TRAIL = "\ude00", PAIR = LEAD + TRAIL, A_SCRIPT = "\ud835\udc9c";
const deep = n => "/" + "(".repeat(n) + "a" + ")".repeat(n) + "/";
const literals = [
  // Annex B and its strict counterparts.
  "/\\1/", "/\\1/u", "/\\8/", "/\\9(a)/", "/(a)\\1/", "/(a)\\2/", "/(a)\\2/u", "/\\c/", "/\\c/u", "/\\c1/", "/[\\c1]/", "/[\\c_]/", "/[\\c]/", "/[\\c]/u", "/\\ca/", "/\\k/", "/\\k/u", "/\\k<a>/", "/\\k<a>/u",
  "/(?<a>)\\k<a>/", "/(?<a>)\\k/", "/\\k<a>(?<a>)/", "/\\u{1F600}/", "/\\u{1F600}/u", "/a{/", "/a{1/", "/a{1,/", "/a{1,2/", "/a{,2}/", "/{1}/", "/{/", "/x{2,1}/", "/x{1,2}?/", "/]/", "/}/", "/]/u", "/}/u", "/\\-/", "/\\-/u", "/[\\-]/u", "/[a-\\d]/", "/[a-\\d]/u", "/[\\d-a]/", "/[\\d-a]/u", "/[b-a]/",
  "/\\x1f/", "/\\x1/", "/\\x1/u", "/\\u00/", "/\\u00/u", "/\\0/", "/\\00/", "/\\01/", "/\\01/u", "/\\377/", "/\\400/", "/\\08/", "/[\\b]/", "/\\b/", "/\\B+/", "/\\b+/u", "/^*/", "/^*/u", "/$+/", "/(?=a)+/", "/(?=a)+/u", "/(?!a){2}/", "/(?<=a)+/", "/(?<!a)/", "/(?<a/", "/(?</", "/(?<=/",
  "/a**/", "/a{1}{2}/", "/a+?+/", "/*/", "/+/", "/?/", "/a|*/", "/(?:)/", "/()/", "/(?:a|b)*?/", "/(/", "/)/", "/(?/", "/(?a)/", "/(?:/", "/[/", "/[a/", "/\\/", "/[\\]/", "/a/gg", "/a/x", "/a/uv", "/a/dgimsuy", "/a/dgimsvy", "/\\//", "/[/]/", "/a\\/b/g",
  // Numbers that a double rounds.
  "/a{99999999999999999999999}/", "/a{9007199254740993,9007199254740992}/", "/a{9007199254740993,9007199254740991}/", "/a{2,99999999999999999999999}/", "/a{99999999999999999999999,2}/", "/\\99999999999999999999/", "/(a)\\00000000000000000001/",
  "/\\u{110000}/u", "/\\u{10FFFF}/u", "/\\u{00000000000000000000041}/u", "/\\u{FFFFFFFFFFFFFFFFFFFFFFFF}/u", "/\\u{}/u", "/\\u{/u", "/\\u{41/u", "/\\uD83D\\uDE00/u", "/\\uD83D\\uDE00/", "/[\\uD83D\\uDE00-\\uD83D\\uDE01]/u", "/\\uD83D/u", "/\\uDE00\\uD83D/u",
  // Surrogates, paired and not.
  `/${PAIR}/`, `/${PAIR}/u`, `/[${PAIR}]/`, `/[${PAIR}]/u`, `/^[${PAIR}]$/v`, `/${PAIR}+/`, `/${PAIR}+/u`, `/${LEAD}/`, `/${LEAD}/u`, `/${TRAIL}/u`, `/${TRAIL}${LEAD}/u`, `/[${LEAD}-${TRAIL}]/`, `/[${TRAIL}-${LEAD}]/`, `/[${TRAIL}-${LEAD}]/u`, `/${LEAD}`, `${LEAD}`, `${PAIR}`, `/a/${PAIR}`, `/a/${LEAD}`, `/(${LEAD}/`, `/(${LEAD}/u`,
  `/(?<${A_SCRIPT}>.)/`, `/(?<${A_SCRIPT}>.)/u`, "/(?<\\ud835\\udc9c>.)/", "/(?<\\ud835\\udc9c>.)/u", "/(?<\\u{1d49c}>.)/", "/(?<\\u{1d49c}>.)/u", `/\\k<${A_SCRIPT}>(?<${A_SCRIPT}>.)/`, `/(?<${LEAD}>.)/`, `/(?<a${LEAD}>.)/`, `/(?<a${TRAIL}>.)/u`, "/(?<\\ud835>.)/", "/(?<a\\u200c\\u200d$_>.)/", "/(?<$>.)\\k<$>/", "/(?<1a>.)/", "/(?<>.)/", "/(?<a>.)(?<a>.)/",
  // Unicode sets.
  "/[[a-z]--[aeiou]]/v", "/[\\q{abc|d|}]/v", "/[^\\q{abc}]/v", "/[^\\q{a}]/v", "/[\\p{RGI_Emoji}]/v", "/[^\\p{RGI_Emoji}]/v", "/\\P{RGI_Emoji}/v", "/\\p{RGI_Emoji}/u", "/[a&&&b]/v", "/[&&]/v", "/[a--]/v", "/[a--b--c]/v", "/[a&&b&&c]/v", "/[a&&b--c]/v", "/[(]/v", "/[\\(]/v", "/[a-z&&[aeiou]]/v", "/[\\p{L}&&\\p{ASCII}]/v", "/[[]]/v", "/[]/v", "/[^]/v", "/[[^a]&&[^b]]/v", "/[a-c\\q{de}]/v", "/[\\q{a|b}--a]/v", "/[^\\q{a|b}--a]/v", "/[^[\\q{ab}]&&a]/v", "/[a!!b]/v", "/[\\&]/v", "/[\\-]/v", "/[\\b]/v", "/[a-]/v", "/[-a]/v", "/[\\q{]/v", "/[\\q]/v", "/[[a]/v", "/[|]/v", "/[{}]/v", "/[\\d-a]/v", "/[a-\\d]/v", "/[z-a]/v",
  // Modifiers and duplicate names.
  "/(?i:a)/", "/(?i-s:a)/", "/(?-:a)/", "/(?ii:a)/", "/(?i-i:a)/", "/(?ims-ims:a)/", "/(?im-sm:a)/", "/(?-i:a)/", "/(?i-:a)/", "/(?g:a)/", "/(?i)/", "/(?i/", "/(?-i/", "/(?i:a)/u", "/(?s-m:a)/v",
  "/(?<a>x)|(?<a>y)/", "/(?<a>x)(?<a>y)/", "/((?<a>x)|(?<a>y))\\k<a>/", "/(?:(?<a>x)|(?<a>y)|(?:(?<a>z)))/", "/(?:(?<a>x)|y)(?<a>z)/", "/(?:(?<a>x)|(?:(?<b>y)|(?<a>z)))(?<b>w)/", "/(?<a>x)|(?:(?<a>y)(?<a>z))/", "/\\k<a>(?<a>x)|(?<a>y)/",
  // Property escapes.
  "/\\p{Script=Greek}/u", "/\\p{Script_Extensions=Kawi}/u", "/\\p{sc=Sunu}/u", "/\\p{scx=Zzzz}/u", "/\\p{Lu}/u", "/\\p{gc=Lu}/u", "/\\p{General_Category=Uppercase_Letter}/u", "/\\p{ASCII}/u", "/\\p{ExtPict}/u", "/\\p{gc=Nope}/u", "/\\p{=}/u", "/\\p{L=}/u", "/\\p{}/u", "/\\p/u", "/\\p/", "/\\p{L}/", "/\\P{L}/u", "/[\\p{L}]/u", "/[\\p{L}-a]/u", "/\\p{Script=}/u", "/\\p{sc}/u", "/\\p{Any}/u", "/\\p{Basic_Emoji}/v",
  // Not a literal.
  "", "/", "//", "/a", "a", " /a/", "/a\n/", "/[\n]/", "/\\\n/", "/a\u2028/", "/a/\n",
  deep(60), "/" + "(?:".repeat(40) + "a" + ")".repeat(40) + "+/", "/" + "[".repeat(30) + "a" + "]".repeat(30) + "/v", "/" + "(?=".repeat(20) + "a" + ")".repeat(20) + "/",
];
const options = [[2025, 0], [2025, 1], [2017, 0], [5, 0]];
const lines = [];
const run = f => { try { return { hash: fnv(dump(f())) }; } catch (e) { if (typeof e.index !== "number") throw e; return { index: e.index, message: e.message }; } };
for (const [ecmaVersion, strict] of options) {
  const opts = { ecmaVersion, strict: Boolean(strict) };
  for (const source of literals) {
    const r = run(() => regexpp.parseRegExpLiteral(source, opts));
    lines.push(r.hash ? ["A", ecmaVersion, strict, esc(source), r.hash].join("\t") : ["E", ecmaVersion, strict, esc(source), r.index, esc(r.message)].join("\t"));
    // The same text as a pattern, under each pair of flags: a `/` is an ordinary character there.
    if (ecmaVersion !== 2025 || strict) continue;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = run(() => new regexpp.RegExpParser(opts).parsePattern(source, 0, source.length, { unicode: Boolean(u), unicodeSets: Boolean(v) }));
      lines.push(p.hash ? ["PA", ecmaVersion, strict, u, v, esc(source), p.hash].join("\t") : ["PE", ecmaVersion, strict, u, v, esc(source), p.index, esc(p.message)].join("\t"));
    }
  }
}
fs.mkdirSync(process.argv[2], { recursive: true });
fs.writeFileSync(path.join(process.argv[2], "extra.txt"), lines.join("\n") + "\n");
const count = k => lines.filter(l => l.startsWith(k + "\t")).length;
console.log({ literals: literals.length, lines: lines.length, A: count("A"), E: count("E"), PA: count("PA"), PE: count("PE"), bytes: fs.statSync(path.join(process.argv[2], "extra.txt")).size });
