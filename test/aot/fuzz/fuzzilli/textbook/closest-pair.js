function closest(list) {
  let best = 1000000;
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i !== j && Math.abs(list[i] - list[j]) < best) best = Math.abs(list[i] - list[j]);
    }
  }
  return best;
}
console.log(closest(JSON.parse("[12,40,7,21,33]")));
