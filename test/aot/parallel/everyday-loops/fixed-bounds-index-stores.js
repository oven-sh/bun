// Stores at the length in the inner loop and at the counter in the outer one
function place(list) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 2; k++) out[out.length] = list[k];
    out[i] = list[i];
  }
  out[out.length + 1] = "last";
  return out.join() + " " + out.length;
}
console.log(place([1, 2, 3, 4]));
console.log(place([0.5, 1, -0, 2]));
console.log(place(["a"]), place([[], [1], null, undefined]));
