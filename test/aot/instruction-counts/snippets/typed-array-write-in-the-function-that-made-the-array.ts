// writes every byte of a Uint8Array ten times in the function that made the array
const operations = 1000;
function lastOfBytesMadeHere(): number {
  const bytes = new Uint8Array(100);
  for (let pass = 0; pass < 10; pass++) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i + pass) & 255;
  }
  return bytes[77];
}
let total = 0;

kernel: {
  total += lastOfBytesMadeHere();
}

console.log(total);
