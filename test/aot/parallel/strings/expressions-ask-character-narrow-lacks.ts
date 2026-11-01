// An expression each of whose alternatives needs a character above U+00FF finds nothing in 8-bit text, and everything it should in 16-bit text.
// Beside them the expressions that only look like it: without regard to case, optional, in a class, in an assertion, behind an alternative that needs none.
const expressions: RegExp[] = [
  /\u2028|\u2029/g,
  /\u2028/,
  /a\u2028/,
  /\u2028a/,
  /(\u2028|\u2029)+/g,
  /(?:\u2028|x\u2029)y/,
  /(?<sep>\u2028)|(?<par>\u2029)/,
  /\u2028{2,}/,
  /^\u2028$/m,
  /\u2028/y,
  /\u2028/u,
  /\u{1F600}/u,
  /\u{1F600}|\u2028/gu,
  /—/g,
  /a—b|c–d/,
  /[\u2028\u2029]/g,
  /[\u2028-\u202f]+x?/,
  /[\u0100-\uffff]/,
  /a[\u2028\u2029]|[—–]b/,
  /\p{Script=Greek}/u,
  /[\p{Script=Greek}\u2028]+/v,
  // These can match 8-bit text.
  /\u2028?/,
  /\u2028*a/,
  /\u2028{0,2}b/,
  /\u2028|a/g,
  /(?:\u2028|)b/,
  /(\u2028)?c/,
  /[\u2028a]/g,
  /[^\u2028]/,
  /[\u00ff-\u2028]/,
  /[\u2028\u2029]?a/,
  /[\u2028\u2029]/i,
  /[\u0178]/i,
  /[\u212a]/iu,
  /[\u212a-\u212b]/i,
  /[^\u0000-\u00ff]|k/,
  /[^\u0100-\uffff]/,
  /\P{Script=Greek}/u,
  /[\q{ab|\u2028}]/v,
  /\W/,
  /\S\u2028?/,
  /(?!\u2028)a/,
  /(?=\u2028)|b/,
  /(?<!\u2028)c/,
  /\u0178/i,
  /\u212a/i,
  /\u212a/iu,
  /\u017f/iu,
  /\u1e9e/i,
  /\u1e9e/iu,
  /(?i:\u0178)/,
  /(?i:\u212a)|\u2028/u,
  /\u00ff/,
  /\u00ff|\u2028/,
  /\u0100?\u00e9/,
  /\b|\u2028/,
  /$|\u2028/,
];
const subjects: string[] = [
  "",
  "a",
  "abc abc",
  "k s ss \u00ff \u00e9 \u00df K S",
  "plain narrow text, {\"type\":\"text\"}",
  "x".repeat(300),
  "a\u2028b\u2029c",
  "\u2028",
  "\u2028\u2028\u2028a",
  "x\u2029y a\u2028 \u2028a",
  "a—b c–d",
  "\u{1F600} and \u2028",
  "\u0178 \u212a \u017f \u1e9e",
  "wide \u0100 but without any of them abc",
];
const lines: string[] = [];
function show(value: unknown): string { return JSON.stringify(value) ?? "undefined"; }
for (const expression of expressions) {
  for (const subject of subjects) {
    const results: string[] = [];
    expression.lastIndex = 0;
    results.push(String(expression.test(subject)), String(expression.lastIndex));
    expression.lastIndex = 0;
    const found = expression.exec(subject);
    results.push(found ? found.index + ":" + show(Array.from(found)) + show(found.groups) : "null");
    expression.lastIndex = 0;
    results.push(String(subject.search(expression)), show(subject.replace(expression, "<$&>").length), show(subject.replace(expression, all => "[" + all.length + "]").length));
    results.push(String(subject.split(expression).length), show(subject.match(expression)?.length ?? null));
    expression.lastIndex = 1;
    results.push(String(expression.test(subject)), String(expression.lastIndex));
    lines.push(expressions.indexOf(expression) + "/" + expression.flags + " on " + subjects.indexOf(subject) + ": " + results.join(" "));
  }
}
// The text of a line for a receiver that splits at line ends, as many a program writes it.
const terminators = /\u2028|\u2029/g;
function safe(value: unknown): string { return JSON.stringify(value).replace(terminators, c => (c === "\u2028" ? "\\u2028" : "\\u2029")); }
lines.push(safe({ a: "narrow" }), safe({ a: "wi\u2028de\u2029" }), safe({ a: "wide — only" }));
// A rope, a substring and a text that was narrow before it was joined with a wide one.
const rope = "left ".repeat(3) + "right";
lines.push(String(terminators.test(rope)), String(terminators.test(rope + "\u2028")), String(terminators.lastIndex), String(/\u2028/.test(("a\u2028b" + rope).slice(3))), String(/\u2028/.test(("a\u2028b" + rope).slice(0, 2))));
console.log(lines.join("\n"));
