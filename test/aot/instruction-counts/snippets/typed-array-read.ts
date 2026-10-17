// adds up the bytes of a Uint8Array
const operations = 100;
const bytes = new Uint8Array(operations);
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  total += sum;
}

console.log(total);
