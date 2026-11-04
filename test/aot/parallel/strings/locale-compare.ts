// Env: LC_ALL=en_US.UTF-8
// Two strings in the order of the default collator: words of eight characters that are the same, the first character that differs within a word,
// what is left behind the words, letters that differ in case alone, a string that begins the other, characters without a weight, ropes, 16-bit strings.

const word = "abcdefgh";
const texts: string[] = [
  "", " ", "0", "9", "a", "A", "b", "B", "z", "Z", "~", "e", "é", "É", "中",
  "ab", "aB", "Ab", "a b", "a-b", "a_b", "a1", "a10", "a2",
  "abcdefg", "abcdefG", word, "abcdefgH", "abcdefgi", "Abcdefgh", "abcXefgh",
  word + "i", word + "I", word + "j", word + "\t", word + "\u0001", word + "\u007f", word + "é", word + "Ā",
  word + "ijklmnop", word + "ijklmnoP", word + "ijklmnoq", word + "Xjklmnop", word + "ijklmnopq",
  word + "\tjklmnop", word + "\tjklmnoq", word + "éjklmnop", word + "éjklmnoq",
  "\t" + word, "\tabcdefgi", "é" + word,
];

function order(left: string, right: string): number {
  return left.localeCompare(right);
}

function mark(result: number): string {
  return result === -1 ? "<" : result === 0 ? "=" : result === 1 ? ">" : `(${result})`;
}

function table(lefts: string[], rights: string[]): void {
  for (const left of lefts) {
    let row = "";
    for (const right of rights) row += mark(order(left, right));
    console.log(row);
  }
}

// Other cells with the same characters. They are ropes until somebody has asked about them, and flat from then on.
const joined = texts.map(text => text.slice(0, text.length >> 1) + text.slice(text.length >> 1));
const pieces = texts.map(text => ("<<" + text + ">>").slice(2, -2));

table(texts, texts);
for (let turn = 0; turn < 2; turn++) {
  table(texts, joined);
  table(joined, pieces);
  table(pieces, texts);
}
console.log(JSON.stringify([...texts].sort(order)));
console.log(JSON.stringify([...pieces].reverse().sort(order)));
