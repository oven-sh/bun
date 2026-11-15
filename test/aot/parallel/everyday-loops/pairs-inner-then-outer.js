// Both parts of destructured pairs pushed, the second by the outer loop
function parts(pairs) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const [left, right] = pairs[i];
    for (let k = 0; k < 2; k++) out.push(pairs[k][0] + left);
    out.push(right);
  }
  return out.join() + " " + out.length;
}
console.log(parts([[1, 2], [3, 4], [5, 6]]));
console.log(parts([[7, 70], [8, 80], [9, 90]]));
console.log(parts([[10, 1], [20, 2], [30, 3]]));
