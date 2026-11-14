function pairs(list, sum) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i] + list[j] === sum) out.push(list[i] + "+" + list[j]);
    }
  }
  return out;
}
console.log(pairs(JSON.parse("[1,9,4,6,5,5]"), 10).join());
