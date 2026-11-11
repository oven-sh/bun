function productsOfOthers(list) {
  const out = [];
  let kept = 1;
  for (let i = 0; i < list.length; i++) {
    out[i] = kept;
    kept *= list[i];
  }
  kept = 1;
  for (let i = list.length - 1; i >= 0; i--) {
    out[i] *= kept;
    kept *= list[i];
  }
  return out;
}
console.log(productsOfOthers(JSON.parse("[1,2,3,4]")).join());
