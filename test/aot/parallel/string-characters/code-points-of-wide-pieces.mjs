// Code points of pieces cut out of wide texts, at every position and beside every edge, and texts that are sought in pieces and as pieces.
const units = JSON.parse('["a","\\ud83d\\ude00","\\ud83d","\\ude00","\\u0430","\\u00e9"]');
const texts = [];
for (const first of units) for (const second of units) for (const third of units) texts.push("q" + first + second + third + "z");
const at = (text, position) => text.codePointAt(position);
let sum = 0;
const add = value => { sum = (Math.imul(sum, 31) + (value === undefined ? 7 : value)) | 0; };
const seen = [];
for (const text of texts) {
  for (let from = 0; from < text.length; from++) {
    for (let to = from + 1; to <= text.length; to++) {
      const piece = text.slice(from, to), whole = [...Array(piece.length).keys()].map(k => String.fromCharCode(piece.charCodeAt(k))).join("");
      for (let position = 0; position <= piece.length; position++) {
        const found = at(text.slice(from, to), position);
        if (found !== whole.codePointAt(position)) seen.push([text, from, to, position, found]);
        add(found);
      }
      add(text.indexOf(text.slice(from, to))); add(text.slice(1).indexOf(text.slice(from, to))); add(text.slice(from, to).indexOf(text.slice(from + 1, to)));
      add(+text.slice(2).includes(text.slice(from, to))); add(text.indexOf(text.slice(from, to), from)); add("abcaxabc".slice(1).indexOf("xabcx".slice(1, 1 + to - from)));
    }
  }
}
console.log(sum, seen.length, JSON.stringify(seen.slice(0, 3)));
