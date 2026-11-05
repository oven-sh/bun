// Big numbers in digits of 26 bits, as jsbn.js keeps them: a digit times a digit plus two carries has up to 53 bits, and a mask cuts the low digit off it.
// The digits come from outside, so the compiler guesses what the variables hold.
function multiplyAndAdd(digits, from, x, into, at, carry, count) {
  while (--count >= 0) {
    var v = x * digits[from++] + into[at] + carry;
    carry = Math.floor(v / 0x4000000);
    into[at++] = v & 0x3ffffff;
  }
  return carry;
}
// The product stays small here, and the variable is the index of a list.
function cell(grid, width, row, column) {
  var index = row * width + column;
  return grid[index] & 0xff;
}
// What is stored is cut first: the variable holds 32 bits.
function hash(codes) {
  var h = 7;
  for (var i = 0; i < codes.length; i++) h = (h * 31 + codes[i]) | 0;
  return h & 0xffff;
}
const [text = "[67108863,67108862,1,0,33554432,12345678,67108863,5]", turns = "2000"] = process.argv.slice(2);
const digits = JSON.parse(text);
const into = digits.map(() => 0).concat(digits.map(() => 0));
let carries = 0;
for (let turn = 0; turn < Number(turns); turn++) {
  for (let i = 0; i < digits.length; i++) carries += multiplyAndAdd(digits, 0, digits[i], into, i, 0, digits.length);
  carries %= 0x4000000;
}
console.log(carries, into.join(), cell(digits, 2, 3, 1), hash(digits));
