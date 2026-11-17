function twoThatAddUp(list, sum) {
  const seen = new Map();
  for (let i = 0; i < list.length; i++) {
    const other = seen.get(sum - list[i]);
    if (other !== undefined) return [other, i];
    seen.set(list[i], i);
  }
  return [];
}
console.log(twoThatAddUp(JSON.parse("[2,7,11,15]"), 26).join());
