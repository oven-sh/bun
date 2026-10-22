// Five callbacks reach one call by value. Where the caller is inlined the first of them is called directly, so no closure of it is left, while the others are still passed.
function keep(text, isMember) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const member = isMember(text.charCodeAt(i));
    if (!member) out += text[i];
  }
  return out;
}
const isHex = (c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102);
const isBlank = (c) => (c >= 9 && c <= 13) || c === 32 || c === 160 || c === 0xfeff || c === 0x2003;
const isWordly = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || c === 95 || (c >= 97 && c <= 122);
const isVowel = (c) => "aeiou".includes(String.fromCharCode(c));
const cases = [
  ["hex", text => keep(text, isHex)],
  ["blank", text => keep(text, isBlank)],
  ["not wordly", text => keep(text, c => !isWordly(c))],
  ["wordly", text => keep(text, isWordly)],
  ["vowels", text => keep(text, isVowel)],
];
const texts = ["", "plain", "f", "cafe babe 2026", "hello  world"];
for (const [name, filtered] of cases)
  for (const text of texts)
    console.log(name, JSON.stringify(filtered(text)));
