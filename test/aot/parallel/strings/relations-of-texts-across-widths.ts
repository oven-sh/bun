// two relations on two texts, and a relation with one written character, across Latin-1 and 16 bits, ropes, pieces, prefixes and the empty text
function order(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function besideLetter(s: string) {
  let bits = 0;
  for (let i = 0; i < 2; i++) bits = (s < "m" ? 1 : 0) + (s <= "m" ? 2 : 0) + (s > "m" ? 4 : 0) + (s >= "m" ? 8 : 0) + ("Ā" < s ? 16 : 0) + ("Ā" >= s ? 32 : 0);
  return bits;
}
function rope(part: string, n: number) {
  let text = "";
  for (let i = 0; i < n; i++) text += part;
  return text;
}
function deed() {
  const texts = ["", "m", "ma", "l", "n", "é", "Ā", "Āa", "mĀ", rope("m", 3), rope("mmĀ", 2).slice(1, 4), "😀", "￿"];
  const out: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    let row = String(besideLetter(texts[i])) + ":";
    for (let j = 0; j < texts.length; j++) row += order(texts[i], texts[j]) + 1;
    out.push(row);
  }
  return out.join(" ");
}
console.log(deed());
for (let i = 0; i < 20; i++) deed();
console.log(deed());
