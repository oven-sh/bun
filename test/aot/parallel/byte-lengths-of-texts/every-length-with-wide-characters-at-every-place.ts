// The number of bytes that a text takes in UTF-8, for every length to 210: no character above 127, one at every place, two of them, all of them.
// COUNT: operation:operationAOTByteLengthOfAnyValue = 0
const plain = "abcdefghijklmnopqrstuvwxyz0123456789".repeat(8);
function flat(text: string): string {
  text.charCodeAt(0);
  return text;
}
let sum = 0;
let checks = 0;
const sums: number[] = [];
for (let length = 0; length <= 210; length++) {
  const base = plain.slice(0, length);
  let ofLength = Buffer.byteLength(base);
  for (let place = 0; place < length; place++) {
    const one = flat(base.slice(0, place) + "é" + base.slice(place + 1));
    ofLength += Buffer.byteLength(one);
    checks++;
    const other = (place * 7 + 3) % length;
    const two = flat(one.slice(0, other) + "\u0080" + one.slice(other + 1));
    ofLength += Buffer.byteLength(two) * 3;
    const edge = flat(base.slice(0, place) + "\u007f" + base.slice(place + 1));
    ofLength += Buffer.byteLength(edge) * 5;
  }
  ofLength += Buffer.byteLength(flat("ÿ".repeat(length) + "")) * 7;
  sums.push(ofLength);
  sum = (sum * 31 + ofLength) % 1000000007;
}
console.log(checks, sum);
console.log(sums.slice(60, 70).join(" "), sums.slice(126, 131).join(" "), sums[210]);
