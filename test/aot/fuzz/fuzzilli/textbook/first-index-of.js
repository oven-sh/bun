function firstPlaceOf(list, wanted) {
  let i = 0;
  while (i < list.length) {
    if (list[i] === wanted) break;
    i++;
  }
  return i === list.length ? -1 : i;
}
const list = JSON.parse("[28,56,25,56]");
console.log(firstPlaceOf(list, 56), firstPlaceOf(list, 30));
