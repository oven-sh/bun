function leaders(list) {
  const found = [];
  let top = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] > top) {
      top = list[i];
      found.push(top);
    }
  }
  return found.reverse();
}
console.log(leaders(JSON.parse("[16,17,4,3,5,2]")).join());
