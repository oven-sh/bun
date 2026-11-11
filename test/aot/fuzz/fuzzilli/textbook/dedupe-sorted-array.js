function withoutDoubles(list) {
  let kept = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === 0 || list[i] !== list[i - 1]) {
      list[kept] = list[i];
      kept++;
    }
  }
  list.length = kept;
  return list;
}
console.log(withoutDoubles(JSON.parse("[1,1,2,2,2,3,4,4]")).join());
