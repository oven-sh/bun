// The outer loop pushes first, then the inner one; every push of the same kind
function steps(list, at) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    out.push(list[at]);
    for (let k = 0; k < 2; k++) {
      out.push(list[at] + k);
    }
  }
  return out.join() + " " + out.length;
}
console.log(steps([1, 2, 3], 1));
console.log(steps([1.5, -0, 3], 1));
console.log(steps(["a", "b"], 0), steps([1], 5));
