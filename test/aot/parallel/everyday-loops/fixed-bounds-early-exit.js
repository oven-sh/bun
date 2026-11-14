// break and continue leave pushes out, on both levels
function some(limit) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < 4; k++) {
      if (k === i) continue;
      if (i + k > limit) break;
      out.push(i * 10 + k);
    }
    if (i === 3) continue;
    out.push("e" + i);
    if (out.length > limit * 4) break;
  }
  return out.join(" ");
}
console.log(some(3));
console.log(some(2.5));
console.log(some(0), some(9));
