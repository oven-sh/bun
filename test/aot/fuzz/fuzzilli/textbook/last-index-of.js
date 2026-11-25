function lastPlaceOf(list, wanted) {
  let i = list.length - 1;
  while (i >= 0) {
    if (list[i] === wanted) break;
    i--;
  }
  return i;
}
const list = JSON.parse("[28,56,25,56]");
console.log(lastPlaceOf(list, 56), lastPlaceOf(list, 30));
