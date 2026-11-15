function steps(list) {
  const out = [];
  for (let i = 1; i < list.length; i++) {
    out[i - 1] = list[i] - list[i - 1];
  }
  return out;
}
console.log(steps(JSON.parse("[2,5,11,12,20]")).join());
