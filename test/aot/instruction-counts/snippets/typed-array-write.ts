// writes every byte of a Uint8Array
const operations = 100;
const bytes = new Uint8Array(operations);
let total = 0;

kernel: {
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
  total += bytes[77];
}

console.log(total);
