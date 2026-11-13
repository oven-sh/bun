function greatestRun(list) {
  let here = 0;
  let best = list[0];
  for (let i = 0; i < list.length; i++) {
    here = Math.max(list[i], here + list[i]);
    best = Math.max(best, here);
  }
  return best;
}
console.log(greatestRun(JSON.parse("[-2,1,-3,4,-1,2,1,-5,4]")));
