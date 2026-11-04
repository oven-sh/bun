function sum(view: Uint8Array): number {
  let total = 0;
  for (const value of view) total += value;
  return total;
}
function sumOfBig(view: BigInt64Array): bigint {
  let total = 0n;
  for (const value of view) total += value;
  return total;
}
const bytes = new Uint8Array(64);
for (let i = 0; i < bytes.length; i++) bytes[i] = i * 3;
const big = new BigInt64Array(8);
for (let i = 0; i < big.length; i++) big[i] = BigInt(i) * 5n;
let all = 0;
let allBig = 0n;
for (let i = 0; i < 300; i++) { all += sum(bytes); allBig += sumOfBig(big); }
console.log(all + " " + allBig);
