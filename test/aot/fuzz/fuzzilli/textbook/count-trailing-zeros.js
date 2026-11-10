function zerosAtTheEnd(list) {
  let i = list.length;
  let count = 0;
  while (i > 0) {
    i--;
    if (list[i] !== 0) break;
    count++;
  }
  return count + ":" + i;
}
console.log(zerosAtTheEnd(JSON.parse("[4,0,7,0,0]")), zerosAtTheEnd(JSON.parse("[0,0]")));
