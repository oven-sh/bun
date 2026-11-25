// A push under a condition beside one that always happens
function keep(mask, list) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    if (i & mask) out.push(list[i]);
    out.push(i);
    if ((i & mask) === mask) out.push(out.length);
  }
  return out.join();
}
console.log(keep(1, [5, 4, 3, 2, 1, 0]));
console.log(keep(2, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]));
console.log(keep(3, "abcdef"), keep(0, []));
