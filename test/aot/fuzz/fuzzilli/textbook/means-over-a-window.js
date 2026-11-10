function means(list, width) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    sum += list[i];
    if (i >= width) sum -= list[i - width];
    if (i >= width - 1) out.push(sum / width);
  }
  return out;
}
console.log(means(JSON.parse("[1,3,5,7,9,11]"), 3).join());
