function sum(view) {
  let total = 0;
  for (const value of view) total += value;
  return total;
}
const bytes = new Uint8Array(64);
for (let i = 0; i < bytes.length; i++) bytes[i] = i * 3;
const fractions = new Float64Array(16);
for (let i = 0; i < fractions.length; i++) fractions[i] = i / 4;
function sumOfFractions(view) {
  let total = 0;
  for (const value of view) total += value;
  return total;
}
let all = 0;
for (let i = 0; i < 300; i++) all += sum(bytes) + sumOfFractions(fractions);
console.log(all);
