// The inner loop pushes; the outer loop then stores at its counter, inside what was pushed
function place(list) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 2; k++) {
      out.push(list[k]);
    }
    out[i] = list[i];
  }
  return out.join() + " " + out.length;
}
console.log(place([5, 1, 0, 2]));
console.log(place([10, 20, 30, 40]));
console.log(place([-1, -2, -3, -4]));
