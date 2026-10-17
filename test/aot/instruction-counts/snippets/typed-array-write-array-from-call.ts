// writes every byte of a Uint8Array that came out of a call
const operations = 100;
function makeBytes(depth: number): Uint8Array {
  if (depth > 0) return makeBytes(depth - 1);
  return new Uint8Array(operations);
}
const bytes = makeBytes(3);
let total = 0;

kernel: {
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
  total += bytes[77];
}

console.log(total);
