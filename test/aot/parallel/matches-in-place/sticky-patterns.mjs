// Sticky patterns that a capture holds, tried at every place of a string in a loop: large alternations, back references, lookaheads, unicode, patterns that may be empty, every kind of subject and lastIndex. What is printed is what plain Bun prints.
const unseen = x => [x][JSON.parse("0")];
const log = [];
const say = (...parts) => log.push(parts.map(p => (typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : String(p))).join(" "));
const scanner = (() => {
  var Mark = /--|\+\+|=>|\.{3}|\??\.(?!\d)|(?:&&|\|\||\?\?|[+\-%&|^]|\*{1,2}|<{1,2}|>{1,3}|!=?|={1,2}|\/(?![\/*]))=?|[?~,:;[\](){}]/y;
  var Name = /(\x23?)(?=[$_\p{ID_Start}\\])(?:[$_\u200c\u200d\p{ID_Continue}]|\\u[\da-fA-F]{4}|\\u\{[\da-fA-F]+\})+/uy;
  var Text = /(['"])(?:(?!\1)[^\\\n\r]|\\(?:\r\n|[^]))*(\1)?/y;
  var Number = /(?:0[xX][\da-fA-F](?:_?[\da-fA-F])*|0[bB][01](?:_?[01])*)n?|0n|[1-9](?:_?\d)*n|(?:(?:0(?!\d)|0\d*[89]\d*|[1-9](?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?|0[0-7]+/y;
  var Template = /[`}](?:[^`\\$]|\\[^]|\$(?!\{))*(`|\$\{)?/y;
  var Space = /[\t\v\f\ufeff\p{Zs}]+/yu;
  var Line = /\r?\n|[\r\u2028\u2029]/y;
  var Block = /\/\*(?:[^*]|\*(?!\/))*(\*\/)?/gy;
  var Rest = /\/\/.*/y;
  var Word = /(?:alpha|beta|gamma|delta|alp|a)(?=[ ,;]|$)/iy;
  var MaybeEmpty = /(?:x|yy|zzz|w)*/y;
  var AtStart = /^(?:a|b|c|d)+/my;
  return function (input, start) {
    var last = start, match, turns = 0, found = "";
    while (turns++ < 60) {
      for (const [name, pattern] of [["none", null]]) found = name;
      Mark.lastIndex = last;
      if ((match = Mark.exec(input))) { say("Mark", match[0], Mark.lastIndex); last = Mark.lastIndex; continue; }
      Name.lastIndex = last;
      if ((match = Name.exec(input))) { say("Name", match[0], match[1], Name.lastIndex); last = Name.lastIndex; continue; }
      Text.lastIndex = last;
      if ((match = Text.exec(input))) { say("Text", match[0], match[1], match[2], Text.lastIndex); last = Text.lastIndex; continue; }
      Number.lastIndex = last;
      if (Number.test(input)) { say("Number", Number.lastIndex); last = Number.lastIndex; continue; }
      Template.lastIndex = last;
      match = Template.exec(input);
      if (match !== null) { say("Template", match[0], match[1], Template.lastIndex); last = Template.lastIndex; continue; }
      say(Template.lastIndex);
      Space.lastIndex = last;
      if ((match = Space.exec(input))) { last = Space.lastIndex; continue; }
      Line.lastIndex = last;
      if ((match = input.match(Line))) { say("Line", match.index, Line.lastIndex); last = Line.lastIndex; continue; }
      Block.lastIndex = last;
      if ((match = Block.exec(input))) { say("Block", match[0], match[1], Block.lastIndex); last = Block.lastIndex; continue; }
      Rest.lastIndex = last;
      if ((match = Rest.exec(input))) { say("Rest", match[0], Rest.lastIndex); last = Rest.lastIndex; continue; }
      Word.lastIndex = last;
      if (Word.test(input)) say("Word", Word.lastIndex);
      MaybeEmpty.lastIndex = last;
      if ((match = MaybeEmpty.exec(input))) say("MaybeEmpty", match[0], MaybeEmpty.lastIndex);
      AtStart.lastIndex = last;
      if ((match = AtStart.exec(input))) say("AtStart", match[0], AtStart.lastIndex);
      last = (+last | 0) + 1;
      if (last > input.length + 1) break;
    }
    say("end", last, found);
  };
})();
const texts = unseen(["", "a", "if (a >>>= b--) { c['x\\'y'] = `t${1}u`; } // d\n/* e *", "0x1F 0b10n .5e+3 1_000 08.5 0.. 017", "#x\\u0061 \u00e9\u00ff=>...?.5??=", "alpha, BETA;gamma\nabcd", "xyyzzzw yy", "\u65e5 + a", "a".repeat(5) + "+".repeat(3), ("<<" + "tokens = 1" + ">>").slice(2, 12), "\r\n\u2028", "'open", "}mid${ $ `", "\u212a\u017f\u00b5"]);
for (const text of texts) for (const start of unseen([0, 1, 3, 100, -1, NaN, 1.5, -0, "2", undefined, null, 2 ** 31, 2 ** 32, 2 ** 53, Infinity, { valueOf() { say("valueOf"); return 1; } }])) {
  try { scanner(text, start); } catch (error) { say(error.name); }
}
let rope = "";
for (const part of unseen(["let x", " = 5;", " x", "++"])) rope += part;
scanner(rope, 0);
console.log(log.length);
console.log(log.join("\n"));
