// parses the digits of a Uint8Array as a 32-bit integer
const operations = 100;
const pattern = "1234567890";
const text = new Uint8Array(operations);
for (let i = 0; i < operations; i++) text[i] = pattern.charCodeAt(i % pattern.length);
let total = 0;

kernel: {
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c < 48 || c > 57) break;
    value = (value * 10 + (c - 48)) | 0;
  }
  total += value;
}

console.log(total);
