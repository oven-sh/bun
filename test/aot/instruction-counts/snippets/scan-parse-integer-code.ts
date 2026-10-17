// parses the digits of a string by charCodeAt as a 32-bit integer
const operations = 100;
const pattern = "1234567890";
let text = "";
for (let i = 0; i < operations - 0; i++) text += pattern[i % pattern.length];
let total = 0;

kernel: {
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 48 || c > 57) break;
    value = (value * 10 + (c - 48)) | 0;
  }
  total += value;
}

console.log(total);
