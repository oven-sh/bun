function sumsBehind(list) {
  const sums = new Array(list.length + 1).fill(0);
  for (let i = list.length - 1; i >= 0; i--) {
    sums[i] = sums[i + 1] + list[i];
  }
  return sums;
}
console.log(sumsBehind(JSON.parse("[3,1,4,1,5,9]")).join());
