// A long undeclared key is seen several times; then a short text has an undeclared key that begins with the same bytes, at the end of the text. Nothing behind the text may be read: an engine built with AddressSanitizer says so.
type Point = { x: number; y: number };
let different = 0;
let parsed = 0;
function check(text: string): void {
  parsed++;
  if (JSON.stringify(JSON.parse<Point>(text)) !== JSON.stringify(JSON.parse(text))) different++;
}
for (const size of [7, 8, 9, 15, 16, 17, 30, 54, 55, 56, 60, 61, 62, 63, 64, 65, 66, 70, 71, 72, 73, 100, 200, 1000, 5000, 100000]) {
  const long = "k".repeat(size);
  for (let round = 0; round < 4; round++) check(`{"x":1,"y":2,"${long}":1}`);
  for (const short of [1, 6, 7, 8, 9, 10, 16, 17, size - 1, size + 1]) {
    if (short < 1) continue;
    for (let round = 0; round < 2; round++) {
      check(`{"x":1,"y":2,"${"k".repeat(short)}":1}`);
      check(`{"x":1,"y":2,"${long}":1}`);
      check(`{"x":1,"${"k".repeat(short)}":1,"y":2}`);
    }
  }
  check(`{"x":1,"y":2,"${long}":1,"${long}z":2,"${long}":3}`);
}
console.log(parsed + " texts, " + different + " differ");
