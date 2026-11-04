// An error quotes what Bun's printer has made of the file. The printer writes a text anew from what it stands for: the quote that leaves least to escape,
// backticks round a line break, its own spelling of each escape, and nothing but ASCII. A name and a regular expression keep their letters but for those.
const o = { f: 1 }, é = { a: 1 }, 字 = { a: 1 };
const tries = [
  () => o.nothing("字"),
  () => o.nothing("é", 1),
  () => o.nothing("😀"),
  () => o.nothing("a字b" + o.f),
  () => o.nothing(function () { return 1; }, "字"),
  () => o.nothing(`字${o.f}é`),
  () => o.nothing(`😀`),
  () => o.nothing(/字é😀/u),
  () => o.nothing(é),
  () => o.nothing(字.a),
  () => 字.nothing(),
  () => o.é(),
  () => o.字.x,
  () => o["é"].x,
  () => o.nothing({ 字: 1, "é": 2 }),
  () => new o.nothing("字"),
  () => "字" in o.nothing,
  () => o.nothing(/* 字 */ 1),
  () => o.nothing("ÿ", "Ā", "", ""),
  () => o.nothing("\u5B57", "\u5b57", "\xe9", "\u{1F600}", "\uD83D\uDE00", "\uD83D"),
  () => o.nothing("\u2028", "\u2029", "\uFEFF"),
  () => o.nothing('a'),
  () => o.nothing('it"s'),
  () => o.nothing("it's"),
  () => o.nothing('a\'b'),
  () => o.nothing("a\"b"),
  () => o.nothing('\'\"'),
  () => o.nothing("\x41\u0042\u{43}"),
  () => o.nothing("\n"),
  () => o.nothing("tab\tnew\nline"),
  () => o.nothing("a\tb"),
  () => o.nothing("a\\b"),
  () => o.nothing("\0", "\x001", "\x07", "\b\f\v\r"),
  () => o.nothing("a\
b"),
  () => o.nothing("${a}\n"),
  () => o.nothing("`\n"),
  () => o.nothing("$\n{"),
  () => o.nothing(`a`),
  () => o.nothing(`a"b`),
  () => o.nothing(`a
b`),
  () => o.nothing(`a\nb${o.f}c\td`),
  () => o.nothing(`\`${o.f}\${`),
  () => o.nothing({ 'a b': 1, "c\n": 2, 'd': 3 }),
  () => o['a b'](),
  () => o.nothing('\q\'', "\/"),
  () => o.nothing(["x\ny"], "x\ny" + o.f),
];
for (const attempt of tries) {
  try {
    attempt();
    console.log("nothing thrown");
  } catch (error) {
    console.log(JSON.stringify(String(error.message)));
  }
}
