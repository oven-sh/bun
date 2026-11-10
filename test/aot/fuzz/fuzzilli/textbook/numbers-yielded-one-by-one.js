function* fibonacci() {
  let [a, b] = [0, 1];
  for (;;) {
    yield a;
    [a, b] = [b, a + b];
  }
}
function taken(source, count) {
  const out = [];
  for (const one of source) {
    if (out.length === count) break;
    out.push(one);
  }
  return out;
}
console.log(taken(fibonacci(), 10).join());
