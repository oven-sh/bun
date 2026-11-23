function sumsInFront(list) {
  const sums = [0];
  for (let i = 0; i < list.length; i++) {
    sums[i + 1] = sums[i] + list[i];
  }
  return sums;
}
console.log(sumsInFront(JSON.parse("[3,1,4,1,5,9]")).join());
