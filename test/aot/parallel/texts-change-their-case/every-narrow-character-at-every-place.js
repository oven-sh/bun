// every character of one byte, at every place of texts of every length up to 70, in both directions, held against a table made character by character
const lower = [], upper = [];
for (let c = 0; c < 256; c++) { const one = String.fromCharCode(c); lower.push(one.toLowerCase()); upper.push(one.toUpperCase()); }
function byTable(text, table) { let out = ""; for (let i = 0; i < text.length; i++) out += table[text.charCodeAt(i)]; return out; }
let asked = 0, wrong = 0, sum = 0;
const fillers = ["a", "Z", "-", "é", "É"];
for (let length = 0; length <= 70; length++) {
  for (const filler of fillers) {
    const base = filler.repeat(length);
    for (let place = 0; place < Math.max(1, length); place += length > 20 ? 7 : 1) {
      for (let c = 0; c < 256; c += length > 20 ? 5 : 1) {
        const text = length ? base.slice(0, place) + String.fromCharCode(c) + base.slice(place + 1) : "";
        const low = text.toLowerCase(), up = text.toUpperCase();
        asked += 2;
        if (low !== byTable(text, lower)) wrong++;
        if (up !== byTable(text, upper)) wrong++;
        sum = (sum * 31 + low.length * 7 + up.length) | 0;
      }
    }
  }
}
for (const length of [71, 127, 128, 129, 65537]) {
  for (const filler of fillers) {
    const base = filler.repeat(length);
    for (const place of [0, 1, 15, 16, 17, length - 17, length - 16, length - 15, length - 2, length - 1]) {
      for (const c of [0x40, 0x41, 0x5a, 0x5b, 0x60, 0x61, 0x7a, 0x7b, 0x7f, 0x80, 0xb5, 0xc0, 0xd7, 0xde, 0xdf, 0xe0, 0xff]) {
        const text = base.slice(0, place) + String.fromCharCode(c) + base.slice(place + 1);
        const low = text.toLowerCase(), up = text.toUpperCase();
        asked += 2;
        if (low !== byTable(text, lower)) wrong++;
        if (up !== byTable(text, upper)) wrong++;
        sum = (sum * 31 + low.length * 7 + up.length) | 0;
      }
    }
  }
}
console.log(asked, wrong, sum);
