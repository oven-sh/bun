// The list is handed in; a list of another kind on the next call
function interleave(list, step) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      out.push(list[k]);
    }
    out.push(list[i] + step);
  }
  return out;
}
console.log(interleave([1, 2, 3], 0).join());
console.log(interleave([4, 5, 6], 1).join());
console.log(interleave([7, 8, 9], 2).join(), interleave([0, 0, 2147483647], 3).join());
