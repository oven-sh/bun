const sum = s => { let n = 0, k = 0, commas = 0; for (const c of s) { n = (n * 31 + c.codePointAt(0)) % 1000003; k += c.length; if (c === ",") commas++; if (c === "\u{1F600}") commas += 100; } return n + ":" + k + ":" + commas; };
const units = s => { let n = 0; for (const c of s) n = (n * 31 + c.charCodeAt(0)) % 1000003; return n; };
const inside = s => { let total = 0; for (const c of s) { let out = ""; out += c; out += "|"; out += c; total += out.length + out.charCodeAt(out.length - 1); } return total; };
const said = [];
for (let place = 0; place < 19; place++) {
  const narrow = "abcdefgh,".repeat(5);
  for (const odd of ["\u{1F600}", "\uD83D", "\uDE00", "Ж", "ÿ", "\uD83D😀", "\uDE00\uD83D"]) {
    const text = narrow.slice(0, place) + odd + narrow.slice(place) + (place & 1 ? odd : "");
    said.push(sum(text), units(text), inside(text));
  }
}
let check = 7;
for (const line of said) for (let i = 0; i < String(line).length; i++) check = (check * 31 + String(line).charCodeAt(i)) % 1000003;
console.log(check, said.length, said.slice(0, 6).join(" "), sum("\u{1F600}".repeat(33)), units("\uD83D".repeat(17) + "\uDE00"), inside(""));
