// The inner loop stores at the length; the outer loop then stores at its counter
function place(list) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 2; k++) {
      out[out.length] = list[k];
    }
    out[i] = list[i];
  }
  out[out.length + 1] = out.length;
  return out.join() + " " + out.length;
}
console.log(place([0.5, 1.5, 2.5, 3.5]));
console.log(place([10.25, 20.25, 30.25, 40.25]));
console.log(place([-0.5, 1e300, 0.125, -2.5]));
