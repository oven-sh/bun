// A reader whose loop asks two helpers at every turn: one reads the unit at this.pos, a pair of surrogates as one number, the other sorts it into ranges and leaves the rest to a pattern and a search
const wide = /[ªµºÀ-ÖØ-ö一-鿿]/;
const astral = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51];
let searches = 0;
function isInSet(code, set) {
  searches++;
  let at = 0x10000;
  for (let index = 0; index < set.length; index += 2) {
    at += set[index];
    if (at > code) return false;
    at += set[index + 1];
    if (at >= code) return true;
  }
  return false;
}
function isWordUnit(code, takesAstral) {
  if (code < 48) return code === 36;
  if (code < 58) return true;
  if (code < 65) return false;
  if (code < 91) return true;
  if (code < 97) return code === 95;
  if (code < 123) return true;
  if (code <= 0xffff) return code >= 0xaa && wide.test(String.fromCharCode(code));
  if (takesAstral === false) return false;
  return isInSet(code, astral);
}
function Reader(input, takesAstral) {
  this.input = input;
  this.pos = 0;
  this.takesAstral = takesAstral;
}
const methods = Reader.prototype;
methods.unitAtPos = function () {
  const code = this.input.charCodeAt(this.pos);
  if (code <= 0xd7ff || code >= 0xdc00) return code;
  const next = this.input.charCodeAt(this.pos + 1);
  return next <= 0xdbff || next >= 0xe000 ? code : (code << 10) + next - 0x35fdc00;
};
methods.readWord = function () {
  const start = this.pos;
  while (this.pos < this.input.length) {
    const code = this.unitAtPos();
    if (isWordUnit(code, this.takesAstral)) this.pos += code <= 0xffff ? 1 : 2;
    else break;
  }
  return this.input.slice(start, this.pos);
};
methods.readWordPastTheEnd = function () {
  const start = this.pos;
  for (;;) {
    const code = this.unitAtPos();
    if (isWordUnit(code, this.takesAstral)) this.pos += code <= 0xffff ? 1 : 2;
    else return this.input.slice(start, this.pos) + ":" + code;
  }
};
methods.words = function (past) {
  const found = [];
  while (this.pos < this.input.length) {
    const word = past ? this.readWordPastTheEnd() : this.readWord();
    if (word) found.push(word);
    if (!past || word.startsWith(":")) this.pos++;
  }
  return found;
};
const made = text => text + String(Date.now()).slice(99);
const texts = [
  "",
  "a",
  "one two  three",
  "$dollar _under 0digit Z9z [bracket] `tick` {brace} ~",
  "/:;<=>?@ AZ[\\]^_` az{|}~",
  "café ªµº ©no ×no ÷no naïve",
  "一二三 mixed一word 　 ￿",
  "𐀀ab 𐀌 𐀋𐀍 x😀y",
  "lone\ud800 \ud800lone \udc00trail trail\udc00 \ud800𐀀",
  "end\ud800",
  "end𐀀",
];
for (const text of texts) {
  for (const input of [made(text), made(text.slice(0, text.length >> 1)) + made(text.slice(text.length >> 1)), made("<<" + text + ">>").slice(2, -2), made(text) + made("") + made(" tail") + made("一")]) {
    for (const takesAstral of [true, false, undefined]) {
      console.log(JSON.stringify(new Reader(input, takesAstral).words(false)), JSON.stringify(new Reader(input, takesAstral).words(true)), searches);
    }
  }
}
const odd = new Reader(made("abc def"), true);
for (const pos of [1.5, -1, 1e10, 2 ** 31, "2", null, true, { valueOf: () => 4 }]) {
  odd.pos = pos;
  let answer;
  try {
    answer = odd.readWordPastTheEnd();
  } catch (error) {
    answer = error.name;
  }
  console.log(String(pos), JSON.stringify(answer), String(odd.pos));
}
let sum = 0;
const long = made("word anotherWord $third _4th café ").repeat(200);
for (let turn = 0; turn < 300; turn++) sum += new Reader(long, true).words(false).length;
console.log(sum, searches);
const replaced = new Reader(made("abc def"), true);
console.log(replaced.readWord());
methods.unitAtPos = function () {
  return this.pos < 6 ? 65 : 32;
};
console.log(replaced.readWord(), replaced.pos);
