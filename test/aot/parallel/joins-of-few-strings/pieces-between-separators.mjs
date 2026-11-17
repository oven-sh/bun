// A few strings, joined with nothing, one character or more between them.
const pieces = ["", "a", "bc", "déf", "Āx", "\u{1f0a1}", "\ud83c", "0123456789abcdef", "ÿ".repeat(9), "あ".repeat(5), "z".repeat(300)];
const separators = [undefined, "", ",", "-", "é", " ", ", ", "\u{1f600}", "a" + "b".repeat(2)];
const show = s => `${s.length}:${s.length > 40 ? s.slice(0, 12) + s.slice(-12) : JSON.stringify(s)}`;
function hash(text) { let h = 7; for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0; return h; }
for (let count = 0; count < 20; count++) {
  for (const separator of separators) {
    const list = [];
    for (let i = 0; i < count; i++) list.push(pieces[(i * 7 + count) % pieces.length]);
    const joined = separator === undefined ? list.join() : list.join(separator);
    console.log(count, show(joined), hash(joined), String(list) === list.join());
  }
}
const rope = "ab" + pieces[4] + count0();
function count0() { return String(pieces.length); }
for (const list of [["a", "b", rope], ["x".slice(0, 1), "yz".slice(1)], ["a", , "b"], ["a", undefined, "b"], ["a", null, "b"], ["a", 1, "b"], ["a", ["b", ["c"]], "d"], ["a", { toString() { return "o"; } }]]) console.log(show(list.join("")), show(list.join()), show(list.join("--")));
const inside = ["x", { toString() { inside[1] = "y"; return "<" + inside.join("") + ">"; } }];
console.log(inside.join("+"), inside.join("+"));
const deck = Array.from({ length: 52 }, (_, i) => String.fromCodePoint(0x1f0a1 + (i % 14)));
let sum = 0;
for (let i = 0; i + 5 < deck.length; i++) { const text = deck.slice(i, i + 5).join(""); sum = (sum + hash(text) * text.length) | 0; }
console.log(sum);
