// A held pattern that RegExp.prototype.compile() changes while a loop matches it: one that is sticky no more leaves lastIndex as it is. What is printed is what plain Bun prints.
const unseen = x => [x][JSON.parse("0")];
const log = [];
const make = () => {
  var A = /a(b)?/y, B = /(\d)/g;
  return (input, when, how) => {
    var m, last = 0, turns = 0;
    while (turns++ < 14) {
      if (turns === when) how(A, B);
      if (turns > when) A.lastIndex = unseen("kept"); else A.lastIndex = last;
      if ((m = A.exec(input))) { last = A.lastIndex; log.push("A " + m[0] + " " + m[1] + " " + typeof last + " " + last); last = +last || 1; }
      if ((m = B.exec(input))) log.push("B " + m[1] + " " + B.lastIndex); else log.push(String(B.lastIndex));
      m = A.exec(input);
      log.push(typeof A.lastIndex + " " + A.lastIndex + " " + (m && m[0]));
      last = (+last | 0) + 1;
    }
  };
};
for (const text of unseen(["ab1ab2", "xxab", "", "12"])) for (const when of unseen([1, 2, 5, 99])) for (const how of [A => A.compile("b"), A => A.compile("b", "y"), (A, B) => B.compile("[a-z]"), (A, B) => { A.compile("(a)|b", "g"); B.compile(A.source, "y"); }]) {
  try { make()(text, when, how); } catch (error) { log.push(error.name); }
}
console.log(log.length);
console.log(log.join("\n"));
