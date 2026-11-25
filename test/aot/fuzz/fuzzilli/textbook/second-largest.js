function secondGreatest(list) {
  let first = -1;
  let second = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i] > first) {
      second = first;
      first = list[i];
    } else if (list[i] > second && list[i] !== first) second = list[i];
  }
  return second;
}
console.log(secondGreatest(JSON.parse("[12,35,1,10,34,1]")));
