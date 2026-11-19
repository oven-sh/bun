// A small function builds a short string in a loop of its own, and a loop appends it: the copy's characters are copied out of its frame.
// COUNT: operation:operationAOTStackStringBuilderFinish <= 2800
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
function letter(n) {
  if (0 <= n && n < alphabet.length) return alphabet[n];
  throw new TypeError("not a digit: " + n);
}
function digits(value) {
  let text = "", digit, rest = value < 0 ? (-value << 1) + 1 : value << 1;
  do {
    digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    text += letter(digit);
  } while (rest > 0);
  return text;
}
function spaces(n) {
  let text = "";
  while (n-- > 0) text += " ";
  return text;
}
function wide(n) {
  let text = "";
  for (let k = 0; k < n; k++) text += k % 3 === 2 ? "☃" : "ab";
  return text;
}
function chars(list) {
  let text = "", previous = 0;
  for (let i = 0; i < list.length; i++) {
    text += digits(list[i] - previous);
    text += spaces(i & 3) + digits(i);
    if (i % 7 === 3) text += wide(i % 5);
    if (i % 11 === 5) text += spaces(i);
    previous = list[i];
  }
  return text;
}
function caught(list) {
  let text = "";
  try {
    for (const item of list) text += digits(item) + ",";
  } catch (error) {
    return text.length + error.message;
  }
  return text;
}
const list = Array.from({ length: 160 }, (_, i) => (i * 7919) % 2003 - (i % 5 ? 0 : 1500));
let sum = 0, text = "";
for (let round = 0; round < 8; round++) {
  text = chars(list.slice(round));
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
}
console.log(text.length, sum, text.slice(0, 120));
console.log(caught([1, 2, 1 << 20, -5]), chars([2 ** 31, -(2 ** 31), NaN, 1.5, "7", null, undefined]));
alphabet.length = 20;
try { console.log(caught([1, 40])); } catch (error) { console.log(error.message); }
