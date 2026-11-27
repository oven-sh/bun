function sorted(list) {
  for (let end = list.length - 1; end > 0; end--) {
    for (let i = 0; i < end; i++) {
      if (list[i] > list[i + 1]) {
        const one = list[i];
        list[i] = list[i + 1];
        list[i + 1] = one;
      }
    }
  }
  return list;
}
console.log(sorted(JSON.parse("[5,1,4,2,8]")).join());
