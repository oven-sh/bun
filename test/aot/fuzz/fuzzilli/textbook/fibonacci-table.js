function table(count) {
  const out = [0, 1];
  for (let i = 2; i < count; i++) {
    out[i] = out[i - 1] + out[i - 2];
  }
  return out;
}
console.log(table(Number("15")).join());
