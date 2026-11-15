// Character codes that only bitwise operators take: outside of the string they are NaN, which counts as zero. Positions that are quotients are truncated.
// STATISTIC: CharacterCodesReadForBits >= 3
const width = 8;
function packed(text) {
  const words = Array();
  const mask = (1 << width) - 1;
  for (let i = 0; i < text.length * width; i += width) words[i >> 5] |= (text.charCodeAt(i / width) & mask) << (i % 32);
  return words;
}
function beyond(text) {
  let hash = 0;
  for (let i = -3; i < text.length + 5; i++) hash = (hash << 5) ^ text.charCodeAt(i) ^ (text.charCodeAt(i / 2) << 3);
  return hash;
}
function fractions(text) {
  let all = 0;
  for (let i = 0; i < text.length * 3; i++) all = (all ^ text.charCodeAt(i / 3) ^ text.charCodeAt((i - 4) / 4)) & 0xffff;
  return all;
}
function inverted(text) {
  let all = 0;
  for (let i = 0; i <= text.length; i++) all = (all * 3) ^ ~text.charCodeAt(i);
  return all;
}
function usedElsewhere(text) {
  let sum = 0, bits = 0;
  for (let i = 0; i <= text.length; i++) {
    const code = text.charCodeAt(i);
    bits ^= code & 15;
    if (code !== code) sum += 1000;
    else sum += code;
  }
  return sum + ":" + bits;
}
const text = "Then are they éÿЖ😀 here? ".repeat(5);
for (const s of [text, text.slice(0, 13), "", "q", "narrow text of its own ".repeat(9)]) console.log(packed(s).join(), beyond(s), fractions(s), inverted(s), usedElsewhere(s));
