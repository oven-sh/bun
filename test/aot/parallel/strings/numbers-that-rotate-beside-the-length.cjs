// An iteration converts the length of its text, and nothing behind the loop reads the integer that comes round.
function beside(text) {
  let p = 1, a = 0.5, b = 0.25, sum = 0;
  for (let i = 0; i < text.length; i++) {
    const x = text.charCodeAt(i);
    const o = x * 0.25 + p * 0.125 + text.length * 0.375 + a * 0.5 + b * -0.125 + a * b * 1e-12 + a * 0.01 + b * 0.02;
    b = a; a = o; p = x;
    sum += o * 0.5 + a * 0.25 - b;
  }
  return [sum, a, b].join();
}
function remainders(text) {
  let s = 12345, p = 1, r = 2, a = 0.5, b = 0.25, sum = 0;
  for (let i = 0; i < text.length; i++) {
    s = (s * 16807 + text.charCodeAt(i)) % 2147483647;
    const x = s | 0;
    const o = x * 0.25 + p * 0.125 + r * 0.0625 + text.length * 0.375 + a * 0.5 + b * -0.125 + a * b * 1e-12 + a * 0.01 + b * 0.02;
    b = a; a = o; r = p; p = x;
    sum += o * 0.5 + a * 0.25 - b;
  }
  return [sum, a, b].join();
}
let text = "", wide = "";
for (let k = 0; k < 48; k++) {
  console.log(k, beside(text), beside(wide), remainders(text), remainders(wide));
  text += String.fromCharCode(48 + k);
  wide += String.fromCharCode(k % 5 ? 48 + k : 0x416 + k);
}
let n = 0;
for (let k = 0; k < 4000; k++) n += beside(text.slice(0, k % 47)).length + remainders(wide.slice(k % 5)).length;
console.log(n);
