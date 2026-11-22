// Products in the inner loop, sums behind it, added up by a third loop
function table(factor) {
  const base = [1, 2, 3, 4];
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) out.push(base[k] * factor);
    out.push(base[i] + i);
  }
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i];
  return sum + " of " + out.length;
}
console.log(table(1));
console.log(table(0.5));
console.log(table(-1e9), table(NaN));
