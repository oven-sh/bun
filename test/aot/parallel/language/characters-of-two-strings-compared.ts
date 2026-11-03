// `a[i] === b[j]` and `!==` on characters of two strings: Latin-1, wider characters, halves of pairs, indexes outside, strings joined late.
const out: string[] = [];
function same(a: string, i: number, b: string, j: number): boolean { return a[i] === b[j]; }
function other(a: string, i: number, b: string, j: number): boolean { return a[i] !== b[j]; }
function loose(a: string, i: number, b: string, j: number): boolean { return a[i] == b[j]; }
function common(a: string, b: string): number { let n = 0; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (a[i] === b[j]) n++; return n; }
const texts = ["", "a", "kitten", "sitting", "éÿĀa", "世界aé", "😀😁", ["ab", "Āc"].join("") + String(out.length), "x".repeat(300) + "ÿ"];
for (const a of texts) {
  let line = `${a.length}:`;
  for (const b of texts) {
    let bits = 0;
    for (let i = -1; i <= 4; i++) for (let j = -1; j <= 4; j++) bits = (bits * 2 + (same(a, i, b, j) ? 1 : 0) + (other(a, i, b, j) ? 3 : 0) + (loose(a, i, b, j) ? 5 : 0)) % 1000003;
    line += ` ${bits}/${common(a, b)}`;
  }
  out.push(line);
}
console.log(out.join("\n"));
