function movedRound(list, by) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    out[(i + by) % list.length] = list[i];
  }
  return out;
}
console.log(movedRound(JSON.parse("[1,2,3,4,5,6,7]"), 3).join());
