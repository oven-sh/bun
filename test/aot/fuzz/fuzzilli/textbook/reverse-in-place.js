function turnedRound(list) {
  let low = 0;
  let high = list.length - 1;
  while (low < high) {
    const one = list[low];
    list[low] = list[high];
    list[high] = one;
    low++;
    high--;
  }
  return list;
}
console.log(turnedRound(JSON.parse("[1,2,3,4,5]")).join());
