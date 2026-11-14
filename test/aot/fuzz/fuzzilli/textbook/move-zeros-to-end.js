function zerosLast(list) {
  let at = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== 0) {
      list[at] = list[i];
      at++;
    }
  }
  for (let i = at; i < list.length; i++) {
    list[i] = 0;
  }
  return list;
}
console.log(zerosLast(JSON.parse("[0,1,0,3,12]")).join());
