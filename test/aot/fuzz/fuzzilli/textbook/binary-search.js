function placeOf(list, sought) {
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (list[middle] === sought) return middle;
    if (list[middle] < sought) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}
const list = JSON.parse("[1,3,5,7,9,11]");
console.log(placeOf(list, 7), placeOf(list, 4));
