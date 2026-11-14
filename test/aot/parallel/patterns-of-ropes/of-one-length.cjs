// Patterns of one length and one set of flags, made of strings that the build has seen: each matches by its own text.
const out = [];
const literals = [/ab+c/, /ab*c/, /ab?c/, /ab+c/g, /ab*c/g, /a[b]c/, /x(y)z/, /x[y]z/];
for (let turn = 0; turn < 40; turn++) {
  for (const sign of ["+", "*", "?"]) {
    const made = new RegExp("ab" + sign + "c"), all = new RegExp("ab" + sign + "c", "g");
    if (turn % 20 === 0) out.push(sign, made.source, made.test("ac"), made.test("abbc"), "abc ac abbc".match(all)?.length, all.flags);
  }
  for (const [open, close] of [["(", ")"], ["[", "]"]]) {
    const made = new RegExp("x" + open + "y" + close + "z");
    if (turn % 20 === 0) out.push(made.source, JSON.stringify(made.exec("xyz")));
  }
}
out.push(literals.map(l => l.source + l.test("abbc")).join());
console.log(out.join("\n"));
