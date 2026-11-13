// STATISTIC: StringsToldApartByNames >= 4
// while (i < text.length) { if (text[i] === " ") ..; text.slice(i, j) }: strings and arrays have these names, so a loop is built for either.
const parse = x => JSON.parse(JSON.stringify(x));
const log = [];
function tokens(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " ") {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] !== " ") j++;
    out.push(text.slice(i, j));
    i = j;
  }
  return out;
}
function numbers(text) {
  let i = 0, s = 0;
  while (i < text.length) {
    let c = text[i];
    if (c >= "0" && c <= "9") {
      const start = i;
      do c = text[++i];
      while (c >= "0" && c <= "9");
      s += Number(text.slice(start, i));
    } else if (c === "-") {
      s = -s;
      i++;
    } else i++;
  }
  return s;
}
function quoted(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    const end = text.indexOf('"', i + 1);
    if (end < 0) break;
    out.push(text.slice(i + 1, end));
    i = end;
  }
  return out;
}
function commas(t) {
  return (() => {
    let s = 0;
    for (const c of t) if (c === ",") s++;
    return s;
  })();
}
class Source {
  constructor(text) {
    this.text = text;
  }
  get length() {
    log.push("length");
    return this.text.length;
  }
  slice(a, b) {
    return "<" + this.text.slice(a, b) + ">";
  }
  indexOf(c, at) {
    return this.text.indexOf(c, at);
  }
}
const growing = [" ", "a", " "];
const values = {
  plain: parse("the quick  brown 12 fox-7 jumps"), empty: parse(""), blank: parse("   "), wide: parse("a\u{1F600} \uD800 bā 34"), rope: parse("12 ") + parse(["34 56"])[0] + " x", quotes: parse('say "a b" and "c" "'),
  list: parse([" ", "a", "b", " ", 5, null, "7"]), chars: [..."a b, c 12"], none: parse([]), holes: ["a", , " ", "b"], numbers: parse([1, 2, 3]), doubles: [1.5, 2.5], view: new Uint8Array([32, 49, 50]), frozen: Object.freeze(["1", " ", "2"]),
  string: Object("a b 1"), source: new Source("a b 12"), like: { length: 3, 0: "a", 1: " ", 2: "1", slice: (a, b) => a + ":" + b, indexOf: () => -1 }, nothing: null, undefined: undefined, number: 5, bare: {}, long: parse("word ".repeat(40)), growing,
};
const show = v => (Array.isArray(v) ? "[" + v.map(show).join("|") + "]" : typeof v === "object" && v ? Object.prototype.toString.call(v) : String(v));
for (let turn = 0; turn < 3; turn++) {
  for (const key of Object.keys(values)) {
    for (const of of [tokens, numbers, quoted, commas]) {
      let said;
      try {
        said = show(of(values[key]));
      } catch (e) {
        said = e.constructor.name + " " + e.message;
      }
      console.log(turn, key, of.name, said);
    }
  }
}
console.log(log.length);
const text0 = parse("the quick brown fox 12 jumps over 34 dogs"), list0 = parse(["a", " ", "b"]), quote0 = parse('x "y z" w');
let total = 0;
for (let k = 0; k < 60; k++) total += tokens(text0).length + numbers(text0) + quoted(quote0).length + tokens(list0).length + commas(text0);
console.log(total);
