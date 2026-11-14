function greatestBehind(list) {
  let top = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const one = list[i];
    list[i] = top;
    if (one > top) top = one;
  }
  return list;
}
console.log(greatestBehind(JSON.parse("[17,18,5,4,6,1]")).join());
