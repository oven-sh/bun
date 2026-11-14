// Elements pushed on both levels, then sorted, then searched by a loop
function ranks(list, wanted) {
  const all = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 2; k++) all.push(list[k] + list[i]);
    all.push(list[i]);
  }
  all.sort((a, b) => a - b);
  const at = [];
  for (let i = 0; i < all.length; i++) if (all[i] === wanted) at.push(i);
  return all.join() + " @ " + at.join("/");
}
console.log(ranks([3, 1, 2, 5], 4));
console.log(ranks([50, 25, 10, 0], 50));
console.log(ranks([1, 1, 1, 1], 2));
