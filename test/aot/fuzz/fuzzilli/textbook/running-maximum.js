function greatestSoFar(list) {
  const out = [];
  let top = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] > top) top = list[i];
    out[i] = top;
  }
  return out;
}
console.log(greatestSoFar(JSON.parse("[3,1,4,1,5,9,2,6]")).join());
