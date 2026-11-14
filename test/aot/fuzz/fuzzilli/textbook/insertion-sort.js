function sorted(list) {
  for (let i = 1; i < list.length; i++) {
    const one = list[i];
    let j = i - 1;
    while (j >= 0 && list[j] > one) {
      list[j + 1] = list[j];
      j--;
    }
    list[j + 1] = one;
  }
  return list;
}
console.log(sorted(JSON.parse("[12,11,13,5,6]")).join());
