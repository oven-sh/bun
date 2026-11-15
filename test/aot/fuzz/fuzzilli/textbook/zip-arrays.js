function sideBySide(a, b) {
  const out = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    out[i] = a[i] + ":" + b[i];
  }
  return out;
}
console.log(sideBySide(JSON.parse('["a","b","c"]'), JSON.parse("[1,2,3,4]")).join());
