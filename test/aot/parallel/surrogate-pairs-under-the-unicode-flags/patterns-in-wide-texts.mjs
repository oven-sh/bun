// Objects of constants, literals and objects in static fields, over flat texts, pieces and joins that hold pairs and halves of pairs.
const units = JSON.parse('["a","b","\\ud83d\\ude00","\\ud83c\\udca1","\\ud83c\\udcb1","\\ud83d","\\ude00","\\u0430"]');
const face = /\u{1f600}/u, trail = /\ude00/u, anyTrail = new RegExp("[\\udc00-\\udfff]", "u"), end = /$/u, word = /[\p{L}--[a-z]]/v;
class Patterns { static pair = new RegExp("([\\u{1f0a1}-\\u{1f0ae}]{2})|([\\u{1f0b1}-\\u{1f0be}])", "u"); static behind = /(?<=a)[^]/u; }
const list = match => match && [match.index, match.input.length, ...match];
const texts = [];
for (const first of units) for (const second of units) for (const third of units) texts.push(first + second + third);
const tests = [
  text => list(text.match(face)), text => list(text.match(trail)), text => list(text.match(anyTrail)), text => list(text.match(Patterns.pair)), text => list(Patterns.behind.exec(text)),
  text => trail.test(text), text => /\ud83d/u.test(text), text => /[^a\u{1f600}]/u.test(text), text => text.search(anyTrail), text => text.search(end), text => list(text.match(end)),
  text => list(/(.)\1/u.exec(text)), text => list(text.match(word)), text => text.replace(anyTrail, "<$&>"), text => text.replace(/./gu, unit => unit.length), text => text.split(/\ude00/u),
  text => { trail.lastIndex = 1; return [trail.test(text), trail.lastIndex, RegExp["$&"].length]; },
];
const hex = value => typeof value === "string" ? Array.from({ length: value.length }, (_, i) => value.charCodeAt(i).toString(16)).join(".") : Array.isArray(value) ? value.map(hex) : value;
tests.forEach((test, number) => {
  let sum = 0;
  const seen = [];
  for (const text of texts) {
    for (const form of [text, (text + "xx").slice(1, text.length), text.slice(2), text + "а" + number]) {
      const said = JSON.stringify(hex(test(form)));
      for (let at = 0; at < said.length; at++) sum = (Math.imul(sum, 31) + said.charCodeAt(at)) | 0;
      if (seen.length < 3 && said !== "null" && said !== "false" && !seen.includes(said)) seen.push(said);
    }
  }
  console.log(number, sum, seen.join(" "));
});
