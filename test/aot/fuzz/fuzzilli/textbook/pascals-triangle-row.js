function row(n) {
  const out = [1];
  for (let i = 1; i <= n; i++) {
    out[i] = 1;
    for (let j = i - 1; j > 0; j--) {
      out[j] = out[j] + out[j - 1];
    }
  }
  return out;
}
console.log(row(Number("6")).join());
