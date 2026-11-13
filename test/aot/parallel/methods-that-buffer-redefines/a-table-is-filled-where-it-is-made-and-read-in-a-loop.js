const table = new Uint8Array(256).fill(1), bytes = new Uint8Array(1024).fill(65), out = new Uint8Array(1024);
table[65] = 7;
function run(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) for (let i = 0; i < 1024; i++) { const b = bytes[i]; out[i] = table[b]; sum += out[i]; }
  return sum;
}
console.log(run(JSON.parse("300")), table.indexOf(7), table.lastIndexOf(1), table.includes(9), table.slice(64, 67).join(), new Uint8Array(4).fill(3).fill(4, 2).join());
