// adds up the bytes of a Uint8Array ten times in the function that made the array
const operations = 1000;
function sumOfBytesMadeHere(): number {
  const bytes = new Uint8Array(100);
  let sum = 0;
  for (let pass = 0; pass < 10; pass++) {
    for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  }
  return sum;
}
let total = 0;

kernel: {
  total += sumOfBytesMadeHere();
}

console.log(total);
