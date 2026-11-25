function counts(list, most) {
  const found = new Array(most + 1).fill(0);
  for (let i = 0; i < list.length; i++) {
    found[list[i]]++;
  }
  return found;
}
console.log(counts(JSON.parse("[1,4,1,2,7,5,2]"), 7).join());
