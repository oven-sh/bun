// counts the small bytes of a Uint8Array, adds up the others and counts equal neighbors
const operations = 100;
const bytes = new Uint8Array(operations);
for (let i = 0; i < operations; i++) bytes[i] = (i * 7) & 127;
let total = 0;

kernel: {
  let low = 0;
  let high = 0;
  let pairs = 0;
  let last = -1;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (byte < 64) low++;
    else high += byte;
    if (byte === last) pairs++;
    last = byte;
  }
  total += low + high * 7 + pairs * 10007;
}

console.log(total);
