function leastFromHereOn(list) {
  const out = [];
  let low = 1000000;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] < low) low = list[i];
    out[i] = low;
  }
  return out;
}
console.log(leastFromHereOn(JSON.parse("[5,3,8,2,9,4]")).join());
