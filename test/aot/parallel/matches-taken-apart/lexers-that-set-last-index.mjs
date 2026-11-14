// A lexer sets lastIndex of a held pattern and matches it. A match that is found, one that is not, one on a rope or on wide text and one past the end leave the lastIndex that plain Bun leaves, and RegExp.lastMatch and its kin. What is printed is what plain Bun prints.
// STATISTIC: LastIndexStoresDeferred >= 3
const unseen = x => [x][JSON.parse("0")];
const log = [];
const say = (...parts) => log.push(parts.map(p => (typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : String(p))).join(" "));
const statics = () => say(RegExp.lastMatch, RegExp.$1, RegExp.$2, RegExp.lastParen, RegExp.leftContext, RegExp.rightContext, RegExp.input);
const lexer = () => {
  var Word = /([a-z])\w*/y, Digits = /(\d+)(\.\d*)?/y, Mark = /[-+*\/]/gy, Late = /=(>)?/g, Plain = /#(\w)/;
  return (text, start, every) => {
    const input = String(text);
    var last = start, m, turns = 0, length = input.length;
    while (last < length) {
      turns++;
      Word.lastIndex = last;
      if ((m = Word.exec(input))) {
        last = Word.lastIndex;
        say("word", m[0], m[1], last);
        if (turns % every === 0) statics();
        continue;
      }
      if (turns % every === 1) say("no word", Word.lastIndex);
      Digits.lastIndex = last;
      m = Digits.exec(input);
      if (m !== null) {
        last = Digits.lastIndex;
        say("digits", m[1], m[2], Digits.lastIndex);
        if (turns % every === 0) statics();
        continue;
      }
      Mark.lastIndex = last;
      if ((m = Mark.exec(input))) {
        last = Mark.lastIndex;
        say("mark", m[0], m.index);
        continue;
      }
      Late.lastIndex = last;
      if ((m = Late.exec(input))) say("late", m[1] === undefined, Late.lastIndex, last);
      else say("not late", Late.lastIndex, Mark.lastIndex, Digits.lastIndex);
      Plain.lastIndex = last;
      if ((m = Plain.exec(input))) say("plain", m[1], Plain.lastIndex);
      if (turns % every === 2) statics();
      last++;
    }
    say("end", last, Word.lastIndex, Digits.lastIndex, Mark.lastIndex, Late.lastIndex, Plain.lastIndex);
  };
};
const halves = unseen(["alpha beta 12.5", " + gamma=>7 #x ="]);
const inputs = unseen(["", "abc", "a1 22.5+b-3*c => #d =e", "  =  ", "9.9.9", "café 12 é", "w日 12 + ab", "-".repeat(50), "x".repeat(300) + " 1"]);
for (const every of unseen([1, 2, 3])) {
  for (const input of inputs) for (let start = 0; start < 4; start++) lexer()(input, start === 3 ? 99 : start, every);
  const lex = lexer();
  lex(halves[0] + halves[1], 0, every);
  lex((halves[0] + halves[1]).slice(3, 25), 0, every);
  for (const input of inputs) lex(input, 0, every);
}
console.log(log.length);
console.log(log.join("\n"));
