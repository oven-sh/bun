// Pieces of other strings appended one after another.
const hidden = new Function("v", "return v") as <V>(v: V) => V;
const narrow = "the quick brown fox jumps over the lazy dog, again and again; ".repeat(40);
const latin = "déjà vu: être ou ne pas être, voilà la question à élucider; ".repeat(40);
const wide = "日本語のテキストと plain text を混ぜたもの; ".repeat(40);

function pieceOf(text: string, from: number, length: number): string {
  return hidden(text.slice(from, from + length));
}
function joinFour(a: string, b: string, c: string, d: string): string {
  let out = "";
  out += a;
  out += "-";
  out += b;
  out += "-";
  out += c;
  out += "-";
  out += d;
  out += ";";
  return out;
}
function joinMany(pieces: string[], times: number): string {
  let out = "<";
  for (let t = 0; t < times; t++) {
    for (let i = 0; i < pieces.length; i++) {
      out += pieces[i];
      out += "|";
    }
  }
  return out + ">";
}

const wrong: string[] = [];
let digest = 0;
function note(name: string, got: string, expected: string): void {
  if (got !== expected || got.length !== expected.length) wrong.push(name);
  for (let i = 0; i < got.length; i += 97) digest = (digest * 31 + got.charCodeAt(i)) | 0;
  digest = (digest * 31 + got.length) | 0;
}

const lengths = [2, 3, 5, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 255, 256, 257, 1000, 2000];
for (const text of [narrow, latin, wide]) {
  for (const length of lengths) {
    const a = pieceOf(text, 1, length), b = pieceOf(text, 7, length), c = pieceOf(text, 13, 2), d = pieceOf(text, 0, length);
    note(`four ${length}`, joinFour(a, b, c, d), [a, b, c, d].join("-") + ";");
    note(`again ${length}`, joinFour(a, a, a, a), [a, a, a, a].join("-") + ";");
    note(`mixed ${length}`, joinFour(a, pieceOf(narrow, 3, length), pieceOf(wide, 2, 3), "x"), [a, narrow.slice(3, 3 + length), wide.slice(2, 5), "x"].join("-") + ";");
  }
}
for (const text of [narrow, latin, wide]) {
  const pieces = [pieceOf(text, 0, 3), pieceOf(text, 5, 11), pieceOf(text, 2, 40), pieceOf(pieceOf(text, 4, 60), 3, 20), hidden(text.slice(9, 12) + text.slice(1, 4))];
  for (const times of [1, 7, 60, 700]) {
    let expected = "<";
    const unit = pieces.join("|") + "|";
    expected += unit.repeat(times) + ">";
    note(`many ${times}`, joinMany(pieces, times), expected);
  }
}
const keyed: Record<string, number> = {};
const base = hidden("alpha-beta-gamma-delta" + String(lengths.length));
const part = pieceOf(base, 6, 4);
keyed[base] = 1;
note("base used as a key", joinFour("[", part, part, "]"), "[-beta-beta-];");
console.log(digest, wrong.length, wrong.slice(0, 8).join("|"));
