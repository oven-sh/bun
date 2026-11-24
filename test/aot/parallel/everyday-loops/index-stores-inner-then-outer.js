// Stores at a running index in the inner loop and behind it
function store(list) {
  const out = [];
  let n = 0;
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      out[n++] = list[k];
    }
    out[n++] = list[i];
  }
  return out.join() + " " + out.length + " " + n;
}
console.log(store([1, 2, 3]));
console.log(store([10, 20, 30]));
console.log(store([4, 5, 6]));
