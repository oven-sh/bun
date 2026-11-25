// The groups of a match are read under a counter: groups that took no part, that are empty, more of them than a frame holds, of joined, cut and wide texts, with other matches in between.
const show = v => (v === undefined ? "_" : v === null ? "null" : JSON.stringify(v));
function joined(expression, text) {
  const match = expression.exec(text);
  if (!match) return "none";
  let out = "";
  for (let i = 0; i < match.length; i++) out += i + "=" + show(match[i]) + " ";
  return out + "at " + match.index + " of " + match.input.length;
}
function lengths(expression, text) {
  let match, all = 0, missing = 0, turns = 0;
  expression.lastIndex = 0;
  while ((match = expression.exec(text)) !== null && turns++ < 40) {
    for (let i = match.length - 1; i > 0; i--) { const group = match[i]; if (group === undefined) missing++; else all += group.length * i; }
    if (!expression.global) break;
    if (match[0] === "") expression.lastIndex++;
  }
  return all + "/" + missing + "/" + turns;
}
function between(expression, other, text) {
  const match = expression.exec(text);
  if (!match) return "none";
  const out = [];
  for (let i = 0; i < match.length + 2; i++) { out.push(show(match[i])); if (other.test(match[i] || "")) out.push(RegExp.$1 + "|" + RegExp["$&"]); if (i === 1) match[2] = "stored"; }
  return out.join(" ");
}
function longest(expression, text) { const match = text.match(expression); let best = -1, size = -1; for (let i = 1; match && i < match.length; i++) if (match[i] !== undefined && match[i].length > size) { size = match[i].length; best = i; } return best + ":" + size; }
const many = new RegExp(Array.from({ length: 30 }, (_, i) => "(" + String.fromCharCode(97 + (i % 26)) + (i % 4 ? "?" : "*") + ")").join(""));
const expressions = [/(\w+)\s(\w+)/, /(a)|(b)|(c)/g, /(x*)(y*)(z*)/, /(?:(\d+)-)?(\d+)(?:\.(\d+))?/g, /^(.)(.*)(.)$/su, many, /(?<first>[a-m]+)(?<second>[n-z]+)?/g, /((((e)?)?)?)/, /(?=(.))(?<!(q))(.)/g, /nothing(here)/];
const words = ["one two three", "abcab", "", "xxzz", "40-70.5 30 7-8", "abcdefghijklmnopqrstuvwxyzabcd", "name value", "e", "\u{1F600}grüß\u{10FFFF}", "q\nq"];
const rope = words.map(word => word + "-" + word.toUpperCase()), cut = words.map(word => ("__" + word + "__").slice(2, -2)), wide = words.map(word => word + "中");
for (const expression of expressions) {
  for (const texts of [words, rope, cut, wide]) {
    console.log(texts.map(text => joined(expression, ((expression.lastIndex = 0), text))).join(" ; "));
    console.log(texts.map(text => lengths(expression, text)).join(), texts.map(text => longest(expression, text)).join());
  }
  console.log(between(expression, /([aeiou])/, words[0]), between(expression, /(\d)/, words[4]), between(expression, /()/, words[7]));
}
class Counted extends RegExp { exec(text) { const match = super.exec(text); if (match) { match.length = Math.min(match.length, 2); match[1] = [match[0]]; } return match; } }
console.log(joined(new Counted("(o)(n)(e)"), "one"), lengths(new Counted("(o)(n)(e)"), "one"));
const indices = /(b+)(c)?/d.exec("abbd"); let spans = ""; for (let i = 0; i < indices.length; i++) spans += JSON.stringify(indices.indices[i] ?? null); console.log(spans);
