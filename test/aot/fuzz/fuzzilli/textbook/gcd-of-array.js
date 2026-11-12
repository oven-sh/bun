function measure(a, b) {
  while (b !== 0) {
    const rest = a % b;
    a = b;
    b = rest;
  }
  return a;
}
function ofAll(list) {
  let kept = list[0];
  for (let i = 1; i < list.length; i++) {
    kept = measure(kept, list[i]);
  }
  return kept;
}
console.log(ofAll(JSON.parse("[48,36,120,60]")));
