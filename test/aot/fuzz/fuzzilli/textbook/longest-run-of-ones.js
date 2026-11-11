function longestRun(list) {
  let run = 0;
  let best = 0;
  for (let i = 0; i < list.length; i++) {
    run = list[i] === 1 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}
console.log(longestRun(JSON.parse("[1,1,0,1,1,1,0,1]")));
