function firstGreater(list, than) {
  let i;
  for (i = 0; i < list.length; i++) {
    if (list[i] > than) break;
  }
  return i;
}
const list = JSON.parse("[3,8,1,9]");
console.log(firstGreater(list, 5), firstGreater(list, 100));
