function longestRise(list) {
  const lengths = [];
  let best = 0;
  for (let i = 0; i < list.length; i++) {
    lengths[i] = 1;
    for (let j = 0; j < i; j++) {
      if (list[j] < list[i] && lengths[j] + 1 > lengths[i]) lengths[i] = lengths[j] + 1;
    }
    if (lengths[i] > best) best = lengths[i];
  }
  return best;
}
console.log(longestRise(JSON.parse("[10,9,2,5,3,7,101,18]")));
