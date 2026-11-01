// A product stands first in a sum of nine terms, and the sum goes into a bit operation. Only two terms are read, so the product is not seen.
// Flags: --aot-limit=MaxTermsReadForProduct:2
// STATISTIC: MaxTermsReadForProductHits >= 1
function split(x, digit, c) {
  var v = x * digit + c + c + c + c + c + c + c + c;
  var low = v & 0x3ffffff;
  var high = v / 0x4000000;
  return low + ":" + v + ":" + Math.floor(high);
}
let last = "";
for (let i = 0; i < 300; i++) last = split(i % 7, 3, 1);
console.log(last);
for (let i = 0; i < 300; i++) last = split(1000003 + i, 1000033, 5);
console.log(last);
console.log(split(2 ** 40, 2 ** 20, 0.5), split(-1e9, 7, -3), split(0.1, 0.2, 0.3));
