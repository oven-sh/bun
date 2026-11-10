function smallerThanEach(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    let count = 0;
    for (let j = 0; j < list.length; j++) {
      if (list[j] < list[i]) count++;
    }
    out[i] = count;
  }
  return out;
}
console.log(smallerThanEach(JSON.parse("[8,1,2,2,3]")).join());
