const texts = ["", "a", "A", "ß", "ÿ", "µ", "×", "÷", "ÀÞ", "Content-Type", "content-type", "CONTENT-TYPE", "X", "xY", "xYz", "ABCD", "abcdE", "1234567", "12345678", "ABCDEFGH", "abcdefghI", "0123456789abcdeF", "0123456789ABCDEFg", "The Quick Brown Fox Jumps Over The Lazy Dog", "İ", "ı", "İ", "Σ", "AΣ", "ẞ", "ﬁ", "𐐀", "K", "STRAßE", "naïve CAFÉ", "x".repeat(63) + "Y", "x".repeat(64) + "Y", "x".repeat(65) + "Y", ("AbÉ").repeat(30), "A".repeat(1000)];
const said = [];
for (let turn = 0; turn < 3; turn++) {
  for (const text of texts) said.push(text.toLowerCase(), text.toUpperCase(), (text + "").toLowerCase(), ("q" + text).toUpperCase(), text.slice(1).toLowerCase(), text.toLowerCase().toUpperCase());
  if (turn === 1) Bun.gc(true);
}
let sum = 0;
for (const text of said) for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
console.log(said.length, sum, said.slice(54, 78).join("|"));
