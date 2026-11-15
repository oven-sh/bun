// while loops with counters of their own push onto one list
function pairs(limit, list) {
  const out = [];
  let i = 0;
  while (i < 4) {
    let k = 0;
    while (k < limit) {
      out.push(list[k++]);
      if (out.length % 5 === 0) out.push("five");
    }
    out.push(i++);
  }
  return out.join();
}
console.log(pairs(2, [1, 2, 3]));
console.log(pairs(3, ["a", 0.5]));
console.log(pairs(0, []), pairs(1, [null]));
